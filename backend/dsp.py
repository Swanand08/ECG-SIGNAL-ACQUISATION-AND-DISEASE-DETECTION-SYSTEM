import numpy as np
from scipy.signal import butter, lfilter, iirnotch, find_peaks

def butter_lowpass(cutoff, fs, order=5):
    nyq = 0.5 * fs
    normal_cutoff = cutoff / nyq
    b, a = butter(order, normal_cutoff, btype='low', analog=False)
    return b, a

def butter_highpass(cutoff, fs, order=5):
    nyq = 0.5 * fs
    normal_cutoff = cutoff / nyq
    b, a = butter(order, normal_cutoff, btype='high', analog=False)
    return b, a

def filter_signal(data, fs=100.0, enabled=True):
    if not enabled or len(data) == 0:
        return data
    
    # 1. Notch Filter (50Hz powerline interference)
    nyq = 0.5 * fs
    freq = 50.0
    # ensure freq < nyq
    if freq < nyq:
        b, a = iirnotch(freq, 30, fs)
        data_notch = lfilter(b, a, data)
    else:
        data_notch = data
        
    # 2. High Pass (0.5Hz for baseline wander)
    b_hp, a_hp = butter_highpass(0.5, fs, order=2)
    data_hp = lfilter(b_hp, a_hp, data_notch)
    
    # 3. Low Pass (40Hz for high frequency noise)
    b_lp, a_lp = butter_lowpass(40.0, fs, order=2)
    data_filtered = lfilter(b_lp, a_lp, data_hp)
    
    return data_filtered

def detect_r_peaks(signal, fs=100.0):
    if len(signal) < 2:
        return np.array([])
    # Distance: at 100Hz, 0.3s is 30 samples. Assuming max HR of 200 BPM
    distance = int(0.3 * fs)
    
    # The amplitude of R-peaks should be prominent.
    # Set threshold based on signal mean and standard deviation
    threshold = np.mean(signal) + 0.6 * np.std(signal)
    
    peaks, _ = find_peaks(signal, distance=distance, height=threshold)
    return peaks
