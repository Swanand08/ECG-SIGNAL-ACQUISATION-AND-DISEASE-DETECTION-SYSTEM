# Real-Time ECG Monitoring Dashboard

Welcome to the **VitalSync ECG Monitoring System**! I have developed a full-stack solution containing both the Python FastAPI backend for signal processing and a dynamic React/Vite dashboard for visualization.

## 🌟 Features Implemented

1. **Live ECG Visualization**: Real-time scrolling chart using `recharts` for high-performance rendering.
2. **Digital Signal Processing**: High Pass (0.5Hz), Low Pass (40Hz), and Notch (50Hz) filters built using `scipy.signal` in Python to remove baseline wander and powerline noise.
3. **Accurate RR Interval & Heart Rate**: R-Peak detection using `scipy.signal.find_peaks` over a sliding window.
4. **Abnormality Detection**: Real-time classification of Heart Rate into Normal, Tachycardia, and Bradycardia.
5. **Dynamic Mock Mode**: Included a built-in mock mode in the UI so you can test the dashboard immediately without an Arduino!
6. **Dark Medical Theme**: Custom Tailwind CSS styling tailored for a sleek, high-contrast, premium medical look.

## 📁 Project Structure

```text
Mini-Project/
├── backend/                  (Python FastAPI Server)
│   ├── main.py               (WebSocket server & Serial port reading)
│   ├── dsp.py                (Digital Filtering & R-Peak logic)
│   ├── mock_data.py          (Simulates Arduino data)
│   └── requirements.txt      (Python Dependencies)
└── frontend/                 (React + Vite Dashboard)
    ├── src/
    │   ├── App.tsx           (Main Dashboard & UI Logic)
    │   ├── index.css         (Tailwind Setup & Theme)
    │   └── main.tsx
    ├── tailwind.config.js
    └── package.json
```

## 🚀 How to Run the Application

### 1. Start the Frontend Dashboard
Open a terminal in the project folder and run:
```bash
cd frontend
npm run dev
```
Open the local URL (usually `http://localhost:5173`) in your browser. 

> [!TIP]
> **Try Mock Mode First!**
> Click the **Mock Mode** toggle in the top right of the dashboard. This will generate a synthetic ECG signal directly in your browser with dynamic noise, simulating real-world R-peak detection and RR intervals without needing the backend!

### 2. Start the Python Backend (For Real Hardware)
If you have an Arduino connected with the AD8232 sensor:
1. Ensure your Arduino is streaming raw values (e.g. `Serial.println(analogRead(A0));`) at 9600 baud.
2. Open `backend/main.py` and modify the COM port if necessary (Line 54: `serial.Serial('COM3', 9600)`).
3. Open a new terminal and run:
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```
4. Once the backend is running, ensure "Mock Mode" is OFF in the dashboard. The UI will connect to the backend WebSocket automatically.

## 🔬 DSP & Algorithmic Design

- **Streaming Architecture**: Data is buffered in chunks (e.g. 5 seconds) and pushed through the DSP pipeline 10 times a second.
- **R-Peak Robustness**: We calculate a dynamic threshold based on signal variance `np.mean(signal) + 0.6 * np.std(signal)` to ensure the peak detection works correctly regardless of amplitude scaling.
- **Signal-to-Noise Ratio**: The backend compares the variance of the raw signal against the filtered signal to give a live quality indicator ("Good", "Moderate", "Poor").
