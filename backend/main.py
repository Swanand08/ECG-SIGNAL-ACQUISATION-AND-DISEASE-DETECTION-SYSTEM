from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import asyncio
import numpy as np
import time
import json
import serial
from serial.serialutil import SerialException

from dsp import filter_signal, detect_r_peaks
from mock_data import generate_mock_ecg_point

from database import init_db, get_db_connection
from auth import get_password_hash, verify_password, create_access_token, get_current_user
from models import UserSignup, UserLogin, Token
import sqlite3
from fastapi import Depends, HTTPException, status

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

FS = 100.0  # Sampling frequency in Hz
BUFFER_SIZE = 500  # 5 seconds of data for processing
SEND_RATE = 10  # How many times per second to send data

class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []
        self.is_filtering_enabled = True
        self.is_running = True

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: str):
        for connection in self.active_connections:
            try:
                await connection.send_text(message)
            except Exception:
                pass

manager = ConnectionManager()

async def read_serial_data():
    raw_buffer = []
    time_buffer = []
    start_time = time.time()
    
    # Try to connect to Arduino
    serial_port = None
    try:
        serial_port = serial.Serial('COM7', 9600, timeout=1)
        print("Connected to serial port")
    except SerialException:
        print("Could not connect to serial port, falling back to mock data")
    
    samples_since_last_send = 0
    samples_per_send = int(FS / SEND_RATE)
    
    while True:
        try:
            if not manager.is_running:
                await asyncio.sleep(0.1)
                continue
                
            val = None
            if serial_port and serial_port.is_open:
                if serial_port.in_waiting > 0:
                    line = serial_port.readline().decode('utf-8').strip()
                    try:
                        val = float(line)
                    except ValueError:
                        pass
            else:
                # Mock data generator
                await asyncio.sleep(1/FS)
                t_current = time.time() - start_time
                val = generate_mock_ecg_point(t_current)
            
            if val is not None:
                current_t = time.time() - start_time
                raw_buffer.append(val)
                time_buffer.append(current_t)
                samples_since_last_send += 1
                
                if len(raw_buffer) > BUFFER_SIZE:
                    raw_buffer.pop(0)
                    time_buffer.pop(0)
                
                # Send data at SEND_RATE
                if samples_since_last_send >= samples_per_send and len(raw_buffer) >= 100:
                    data_arr = np.array(raw_buffer)
                    filtered_arr = filter_signal(data_arr, FS, enabled=manager.is_filtering_enabled)
                    
                    # Detect peaks on the filtered signal to be accurate
                    peaks = detect_r_peaks(filtered_arr, FS)
                    
                    # Calculate RR intervals
                    rr_intervals = []
                    if len(peaks) > 1:
                        peak_times = np.array(time_buffer)[peaks]
                        rr_intervals = np.diff(peak_times).tolist()
                    
                    latest_hr = 0
                    status = "Normal"
                    if rr_intervals:
                        latest_rr = rr_intervals[-1]
                        if latest_rr > 0:
                            latest_hr = 60.0 / latest_rr
                            
                        # Basic status logic
                        if latest_hr < 60:
                            status = "Bradycardia"
                        elif latest_hr > 100:
                            status = "Tachycardia"
                    
                    # Estimate SNR (Signal-to-Noise Ratio) very roughly
                    signal_power = np.var(filtered_arr)
                    noise_power = np.var(data_arr - filtered_arr) if manager.is_filtering_enabled else 1e-6
                    snr = 10 * np.log10(signal_power / max(noise_power, 1e-6))
                    if snr > 15:
                        quality = "Good"
                    elif snr > 5:
                        quality = "Moderate"
                    else:
                        quality = "Poor"

                    # Get recent samples to send to frontend
                    # Send only the new samples to save bandwidth, or send the whole window?
                    # For a web dashboard, it's easier to append new points on the frontend.
                    recent_times = time_buffer[-samples_since_last_send:]
                    recent_raw = raw_buffer[-samples_since_last_send:]
                    recent_filtered = filtered_arr[-samples_since_last_send:].tolist()
                    
                    payload = {
                        "time": recent_times,
                        "raw": recent_raw,
                        "filtered": recent_filtered,
                        "rr_intervals": rr_intervals[-10:] if rr_intervals else [],
                        "hr": round(latest_hr, 1),
                        "status": status,
                        "snr": round(snr, 1),
                        "quality": quality,
                        "peaks": np.array(time_buffer)[peaks].tolist()
                    }
                    
                    await manager.broadcast(json.dumps(payload))
                    samples_since_last_send = 0
                    
        except Exception as e:
            print(f"Error in data loop: {e}")
            await asyncio.sleep(1)

@app.on_event("startup")
async def startup_event():
    init_db()
    asyncio.create_task(read_serial_data())

@app.post("/signup", status_code=status.HTTP_201_CREATED)
def signup(user: UserSignup):
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        # Check if user already exists
        cursor.execute("SELECT id FROM users WHERE email = ?", (user.email,))
        if cursor.fetchone():
            raise HTTPException(status_code=400, detail="Email already registered")
            
        hashed_pw = get_password_hash(user.password)
        cursor.execute(
            "INSERT INTO users (full_name, email, hashed_password) VALUES (?, ?, ?)",
            (user.full_name, user.email, hashed_pw)
        )
        conn.commit()
        return {"message": "User created successfully"}
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=400, detail="Email already registered")
    finally:
        conn.close()

@app.post("/login", response_model=Token)
def login(user: UserLogin):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, full_name, email, hashed_password FROM users WHERE email = ?", (user.email,))
    db_user = cursor.fetchone()
    conn.close()
    
    if not db_user:
        raise HTTPException(status_code=400, detail="Invalid email or password")
        
    if not verify_password(user.password, db_user["hashed_password"]):
        raise HTTPException(status_code=400, detail="Invalid email or password")
        
    access_token = create_access_token(data={"sub": db_user["email"]})
    return {
        "access_token": access_token, 
        "token_type": "bearer",
        "user": {
            "id": db_user["id"],
            "full_name": db_user["full_name"],
            "email": db_user["email"]
        }
    }

@app.get("/me")
def get_me(current_user: dict = Depends(get_current_user)):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, full_name, email FROM users WHERE email = ?", (current_user["sub"],))
    db_user = cursor.fetchone()
    conn.close()
    
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
        
    return {
        "id": db_user["id"],
        "full_name": db_user["full_name"],
        "email": db_user["email"]
    }

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            if "action" in message:
                if message["action"] == "start":
                    manager.is_running = True
                elif message["action"] == "stop":
                    manager.is_running = False
                elif message["action"] == "toggle_filter":
                    manager.is_filtering_enabled = message.get("enabled", True)
    except WebSocketDisconnect:
        manager.disconnect(websocket)
