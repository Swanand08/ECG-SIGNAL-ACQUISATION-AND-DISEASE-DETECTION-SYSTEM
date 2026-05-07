import math
import random

def generate_mock_ecg_point(t):
    # Simulate a basic ECG signal + noise
    # Base heart rate ~ 75 bpm (1.25 Hz)
    hr_hz = 1.25
    phase = (t * hr_hz) % 1.0
    
    # Constructing a synthetic ECG wave
    # P wave
    p = 0.15 * math.exp(-((phase - 0.15)**2) / 0.001)
    # QRS complex
    q = -0.15 * math.exp(-((phase - 0.45)**2) / 0.0001)
    r = 1.5 * math.exp(-((phase - 0.5)**2) / 0.0005)
    s = -0.25 * math.exp(-((phase - 0.55)**2) / 0.0001)
    # T wave
    t_wave = 0.35 * math.exp(-((phase - 0.8)**2) / 0.004)
    
    clean_signal = p + q + r + s + t_wave
    
    # Add noise
    baseline_wander = 0.3 * math.sin(2 * math.pi * 0.2 * t)
    powerline_noise = 0.1 * math.sin(2 * math.pi * 50 * t)
    random_noise = random.uniform(-0.15, 0.15)
    
    noisy_signal = clean_signal + baseline_wander + powerline_noise + random_noise
    return noisy_signal
