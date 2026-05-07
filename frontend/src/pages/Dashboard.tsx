import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip } from 'recharts';
import { Activity, Heart, AlertTriangle, Settings, Power, RefreshCw, ActivitySquare, HeartPulse, Zap, FileText, Usb } from 'lucide-react';
import jsPDF from 'jspdf';
import * as htmlToImage from 'html-to-image';
import { useAuth } from '../context/AuthContext';

interface ECGDataPoint {
  time: number;
  raw: number;
  filtered: number;
}

interface RRDataPoint {
  index: number;
  rr: number;
}

interface AlertLog {
  time: string;
  message: string;
}

export default function Dashboard() {
  const { user, logout } = useAuth();
  const [isConnected, setIsConnected] = useState(false);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [isFiltering, setIsFiltering] = useState(true);
  const [isRunning, setIsRunning] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  
  const [ecgData, setEcgData] = useState<ECGDataPoint[]>([]);
  const [rrTrend, setRrTrend] = useState<RRDataPoint[]>([]);
  
  const [heartRate, setHeartRate] = useState(0);
  const [latestRR, setLatestRR] = useState(0);
  const [status, setStatus] = useState("Waiting");
  const [quality, setQuality] = useState("Unknown");

  // History tracking for PDF report
  const [sessionStartTime] = useState<number>(Date.now());
  const [hrHistory, setHrHistory] = useState<number[]>([]);
  const [alertHistory, setAlertHistory] = useState<AlertLog[]>([]);
  const lastAlertStatusRef = useRef<string>("Waiting");
  
  const wsRef = useRef<WebSocket | null>(null);
  const demoIntervalRef = useRef<number | null>(null);
  const [isArduinoConnected, setIsArduinoConnected] = useState(false);
  const serialReaderRef = useRef<ReadableStreamDefaultReader | null>(null);

  const connectArduino = useCallback(async () => {
    if (isArduinoConnected) {
      // Disconnect
      try {
        if (serialReaderRef.current) {
          await serialReaderRef.current.cancel();
          serialReaderRef.current = null;
        }
      } catch (_) {}
      setIsArduinoConnected(false);
      return;
    }

    if (!('serial' in navigator)) {
      alert('Web Serial API is not supported. Please use Chrome or Edge browser.');
      return;
    }

    try {
      // @ts-ignore
      const port = await (navigator as any).serial.requestPort();
      await port.open({ baudRate: 9600 });
      setIsArduinoConnected(true);

      const reader = port.readable.getReader();
      serialReaderRef.current = reader;
      let lineBuffer = '';

      const readLoop = async () => {
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            const chunk = new TextDecoder().decode(value);
            lineBuffer += chunk;
            const lines = lineBuffer.split('\n');
            lineBuffer = lines.pop() || '';
            for (const line of lines) {
              const trimmed = line.trim();
              const val = parseFloat(trimmed);
              if (!isNaN(val) && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({ type: 'raw_data', value: val }));
              }
            }
          }
        } catch (err) {
          // Reader cancelled or port closed
        } finally {
          setIsArduinoConnected(false);
          serialReaderRef.current = null;
        }
      };

      readLoop();
    } catch (err: any) {
      if (err.name !== 'NotFoundError') {
        alert('Could not connect to Arduino: ' + err.message);
      }
    }
  }, [isArduinoConnected]);
  
  // Dynamic CSS variable for heartbeat animation
  useEffect(() => {
    if (heartRate > 0) {
      document.documentElement.style.setProperty('--beat-duration', `${60 / heartRate}s`);
    }
  }, [heartRate]);

  // Connect to actual WebSocket Backend
  useEffect(() => {
    if (isDemoMode) {
      if (wsRef.current) {
        wsRef.current.close();
      }
      return;
    }
    
    const connectWs = () => {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000';
      const wsUrl = apiUrl.replace(/^http/, 'ws') + '/ws';
      wsRef.current = new WebSocket(wsUrl);
      
      wsRef.current.onopen = () => {
        setIsConnected(true);
        setStatus("Connected");
      };
      
      wsRef.current.onmessage = (event) => {
        if (!isRunning) return;
        
        try {
          const data = JSON.parse(event.data);
          
          if (data.time && data.raw && data.filtered) {
            const newPoints: ECGDataPoint[] = data.time.map((t: number, i: number) => ({
              time: t,
              raw: data.raw[i],
              filtered: data.filtered[i]
            }));
            
            setEcgData(prev => {
              const merged = [...prev, ...newPoints];
              if (merged.length > 500) return merged.slice(merged.length - 500);
              return merged;
            });
          }
          
          if (data.hr && data.hr > 0) {
            setHeartRate(data.hr);
            setHrHistory(prev => [...prev, data.hr]);
          }
          
          if (data.status) {
            setStatus(data.status);
            // Track alerts
            if ((data.status === "Bradycardia" || data.status === "Tachycardia") && lastAlertStatusRef.current !== data.status) {
                setAlertHistory(prev => [...prev, { time: new Date().toLocaleTimeString(), message: `${data.status} Detected` }]);
                lastAlertStatusRef.current = data.status;
            } else if (data.status === "Normal") {
                lastAlertStatusRef.current = "Normal";
            }
          }
          
          if (data.quality) setQuality(data.quality);
          
          if (data.rr_intervals && data.rr_intervals.length > 0) {
            const lastRR = data.rr_intervals[data.rr_intervals.length - 1];
            setLatestRR(lastRR);
            
            setRrTrend(prev => {
              const newRRs = data.rr_intervals.map((rr: number, i: number) => ({
                index: prev.length + i,
                rr: rr
              }));
              const merged = [...prev, ...newRRs];
              if (merged.length > 50) return merged.slice(merged.length - 50);
              return merged;
            });
          }
        } catch (e) {
          console.error("Error parsing websocket message", e);
        }
      };
      
      wsRef.current.onclose = () => {
        setIsConnected(false);
        setStatus("Disconnected");
        setTimeout(connectWs, 3000);
      };
    };
    
    connectWs();
    return () => {
      if (wsRef.current) wsRef.current.close();
    };
  }, [isDemoMode, isRunning]);

  // Demo Mode Generation
  useEffect(() => {
    if (!isDemoMode || !isRunning) {
      if (demoIntervalRef.current) clearInterval(demoIntervalRef.current);
      return;
    }
    
    let t = 0;
    let rrCount = 0;
    
    setIsConnected(true);
    setStatus("Normal");
    setQuality("Good");
    
    demoIntervalRef.current = window.setInterval(() => {
      const newPoints: ECGDataPoint[] = [];
      const hr_hz = 1.25; 
      
      for (let i = 0; i < 10; i++) {
        const time = t + i * 0.01;
        const phase = (time * hr_hz) % 1.0;
        
        const p = 0.15 * Math.exp(-Math.pow(phase - 0.15, 2) / 0.001);
        const q = -0.15 * Math.exp(-Math.pow(phase - 0.45, 2) / 0.0001);
        const r = 1.5 * Math.exp(-Math.pow(phase - 0.5, 2) / 0.0005);
        const s = -0.25 * Math.exp(-Math.pow(phase - 0.55, 2) / 0.0001);
        const tw = 0.35 * Math.exp(-Math.pow(phase - 0.8, 2) / 0.004);
        
        const clean = p + q + r + s + tw;
        const baseline = 0.3 * Math.sin(2 * Math.PI * 0.2 * time);
        const powerline = 0.1 * Math.sin(2 * Math.PI * 50 * time);
        const noise = (Math.random() - 0.5) * 0.2;
        
        newPoints.push({
          time,
          raw: clean + baseline + powerline + noise,
          filtered: clean
        });
        
        if (Math.abs(phase - 0.5) < 0.005) {
          const rrVal = 0.8 + (Math.random() - 0.5) * 0.05;
          const currentHr = Math.round(60 / rrVal);
          setLatestRR(rrVal);
          setHeartRate(currentHr);
          setHrHistory(prev => [...prev, currentHr]);
          
          setRrTrend(prev => {
            const next = [...prev, { index: rrCount++, rr: rrVal }];
            return next.length > 50 ? next.slice(next.length - 50) : next;
          });
          
          if (Math.random() > 0.95) {
              const demoStatus = Math.random() > 0.5 ? "Tachycardia" : "Bradycardia";
              setStatus(demoStatus);
              if (lastAlertStatusRef.current !== demoStatus) {
                  setAlertHistory(prev => [...prev, { time: new Date().toLocaleTimeString(), message: `${demoStatus} Detected` }]);
                  lastAlertStatusRef.current = demoStatus;
              }
          } else {
              setStatus("Normal");
              lastAlertStatusRef.current = "Normal";
          }
        }
      }
      
      t += 0.1;
      
      setEcgData(prev => {
        const next = [...prev, ...newPoints];
        return next.length > 500 ? next.slice(next.length - 500) : next;
      });
      
    }, 100);
    
    return () => {
      if (demoIntervalRef.current) clearInterval(demoIntervalRef.current);
    };
  }, [isDemoMode, isRunning]);

  const toggleRun = () => {
    setIsRunning(!isRunning);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: isRunning ? "stop" : "start" }));
    }
  };

  const toggleFilter = () => {
    setIsFiltering(!isFiltering);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: "toggle_filter", enabled: !isFiltering }));
    }
  };

  const exportPDF = async () => {
    setIsExporting(true);
    
    try {
        const doc = new jsPDF();
        
        doc.setFontSize(22);
        doc.setTextColor(0, 136, 170);
        doc.text("VitalSyncPro: ECG Monitoring Report", 105, 20, { align: "center" });
        
        doc.setFontSize(10);
        doc.setTextColor(100);
        doc.text(`Generated on: ${new Date().toLocaleString()}`, 105, 27, { align: "center" });
        
        doc.setDrawColor(200);
        doc.line(20, 32, 190, 32);

        doc.setFontSize(14);
        doc.setTextColor(40);
        doc.text("A. Patient Information", 20, 45);
        doc.setFontSize(11);
        doc.setTextColor(80);
        doc.text(`Patient ID: ${user?.full_name || 'Demo User'}`, 25, 55);
        doc.text(`Session Start: ${new Date(sessionStartTime).toLocaleString()}`, 25, 62);
        
        const durationMins = Math.floor((Date.now() - sessionStartTime) / 60000);
        const durationSecs = Math.floor(((Date.now() - sessionStartTime) % 60000) / 1000);
        doc.text(`Total Duration: ${durationMins}m ${durationSecs}s`, 25, 69);

        doc.setFontSize(14);
        doc.setTextColor(40);
        doc.text("B. ECG Waveform Summary", 20, 85);
        
        const chartElement = document.getElementById("ecg-chart-container");
        if (chartElement) {
           const imgData = await htmlToImage.toPng(chartElement, {
               backgroundColor: '#0B0E14',
               pixelRatio: 2,
               filter: (node) => {
                   if (node instanceof HTMLElement && node.hasAttribute('data-html2canvas-ignore')) {
                       return false;
                   }
                   return true;
               }
           });
           doc.addImage(imgData, 'PNG', 20, 92, 170, 50);
        } else {
           doc.setFontSize(10);
           doc.text("[Chart Snapshot Unavailable]", 25, 100);
        }

        doc.setFontSize(14);
        doc.setTextColor(40);
        doc.text("C. Heart Rate Analysis", 20, 155);
        
        const avgHr = hrHistory.length ? Math.round(hrHistory.reduce((a, b) => a + b, 0) / hrHistory.length) : heartRate;
        const minHr = hrHistory.length ? Math.min(...hrHistory) : heartRate;
        const maxHr = hrHistory.length ? Math.max(...hrHistory) : heartRate;

        doc.setFontSize(11);
        doc.setTextColor(80);
        doc.text(`Current Heart Rate: ${heartRate} BPM`, 25, 165);
        doc.text(`Average Heart Rate: ${avgHr} BPM`, 25, 172);
        doc.text(`Min / Max HR: ${minHr} / ${maxHr} BPM`, 25, 179);

        doc.setFontSize(14);
        doc.setTextColor(40);
        doc.text("D. RR Interval Analysis", 110, 155);
        
        const avgRr = rrTrend.length ? (rrTrend.reduce((a, b) => a + b.rr, 0) / rrTrend.length).toFixed(3) : latestRR.toFixed(3);
        doc.setFontSize(11);
        doc.setTextColor(80);
        doc.text(`Latest RR Interval: ${latestRR.toFixed(3)} s`, 115, 165);
        doc.text(`Average RR Interval: ${avgRr} s`, 115, 172);
        
        doc.setFontSize(10);
        doc.text("Last 5 RR Intervals:", 115, 180);
        const recentRRs = [...rrTrend].slice(-5).reverse();
        recentRRs.forEach((rr, i) => {
            doc.text(`${i+1}. ${rr.rr.toFixed(3)} s`, 120, 186 + (i * 5));
        });

        doc.setFontSize(14);
        doc.setTextColor(40);
        doc.text("E & F. Quality and Patient Condition", 20, 210);
        doc.setFontSize(11);
        doc.setTextColor(80);
        doc.text(`Signal Quality: ${quality}`, 25, 220);
        
        if (status === "Normal") {
            doc.setTextColor(0, 150, 0);
        } else {
            doc.setTextColor(200, 0, 0);
        }
        doc.text(`Current Condition: ${status}`, 25, 227);

        doc.setFontSize(14);
        doc.setTextColor(40);
        doc.text("G. Alert History", 110, 210);
        doc.setFontSize(10);
        doc.setTextColor(80);
        
        if (alertHistory.length === 0) {
           doc.text("No abnormal alerts triggered.", 115, 220);
        } else {
           const recentAlerts = [...alertHistory].slice(-5);
           recentAlerts.forEach((alert, i) => {
               doc.text(`[${alert.time}] ${alert.message}`, 115, 220 + (i * 6));
           });
        }

        doc.setFontSize(14);
        doc.setTextColor(40);
        doc.text("H. Remarks", 20, 245);
        
        doc.setFontSize(11);
        doc.setTextColor(80);
        const isAbnormal = status === "Bradycardia" || status === "Tachycardia";
        const remark = isAbnormal ? `Elevated/Abnormal heart rate detected: ${status}. Monitor closely.` : "Heart rate is within normal range.";
        doc.text(remark, 25, 255);

        doc.setDrawColor(200);
        doc.line(20, 275, 190, 275);
        doc.setFontSize(9);
        doc.setTextColor(150);
        doc.text("Disclaimer: This is a preliminary analysis and not a clinical diagnosis. Consult a physician.", 105, 282, { align: "center" });

        const fileName = `ECG_Report_${new Date().toISOString().split('T')[0]}_${new Date().getHours()}-${new Date().getMinutes()}.pdf`;
        doc.save(fileName);
    } catch (e) {
        console.error("Failed to generate PDF", e);
    } finally {
        setIsExporting(false);
    }
  };

  const statusBg = useMemo(() => {
    if (status === "Bradycardia") return "bg-warning/10 border-warning/50 shadow-[0_0_30px_rgba(255,184,0,0.2)]";
    if (status === "Tachycardia") return "bg-danger/10 border-danger/50 shadow-[0_0_30px_rgba(255,0,60,0.2)]";
    if (status === "Normal") return "bg-success/10 border-success/50 shadow-[0_0_30px_rgba(0,255,136,0.15)]";
    return "bg-surface border-surfaceBorder";
  }, [status]);

  const statusColor = useMemo(() => {
    if (status === "Bradycardia") return "text-warning neon-text-warning";
    if (status === "Tachycardia") return "text-danger neon-text-danger";
    if (status === "Normal") return "text-success neon-text-success";
    return "text-gray-400";
  }, [status]);

  const statusMessage = useMemo(() => {
    if (status === "Bradycardia") return "⚠ Bradycardia Detected";
    if (status === "Tachycardia") return "⚠ Tachycardia Detected";
    if (status === "Normal") return "✔ Normal Heart Rate";
    return status;
  }, [status]);

  return (
    <div className="min-h-screen p-4 md:p-6 lg:p-8 flex flex-col gap-6 relative">
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-primary/10 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[40%] h-[40%] rounded-full bg-purple/10 blur-[120px] pointer-events-none" />

      <header className="flex justify-between items-center glass-panel p-5 px-8 relative z-10 overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary via-purple to-success" />
        <div className="flex items-center gap-4">
          <div className="p-2 bg-primary/20 rounded-xl">
            <HeartPulse className="text-primary w-8 h-8" />
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white neon-text">
            VitalSync<span className="font-light text-primary/80">Pro</span>
          </h1>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3 bg-black/40 px-4 py-2 rounded-full border border-surfaceBorder shadow-inner hidden md:flex">
            <span className={`w-3 h-3 rounded-full ${isConnected ? 'bg-success shadow-[0_0_12px_#00FF88] animate-pulse' : 'bg-danger shadow-[0_0_12px_#FF003C]'}`}></span>
            <span className="text-sm font-bold tracking-wider text-gray-200">
              {isConnected ? 'LIVE STREAM' : 'DISCONNECTED'}
            </span>
          </div>
          <button 
            onClick={() => setIsDemoMode(!isDemoMode)}
            className={`group px-6 py-2.5 rounded-full text-sm font-bold transition-all duration-300 border flex items-center gap-2 ${isDemoMode ? 'bg-primary/20 text-primary border-primary/50 shadow-[0_0_20px_rgba(0,240,255,0.3)] hover:bg-primary/30' : 'bg-surface border-surfaceBorder text-gray-400 hover:text-white hover:border-gray-500'}`}
          >
            <Zap className={`w-4 h-4 ${isDemoMode ? 'text-primary animate-pulse' : 'text-gray-500 group-hover:text-warning transition-colors'}`} />
            SIMULATE {isDemoMode ? 'ON' : 'OFF'}
          </button>
          <button
            onClick={connectArduino}
            title="Connect your Arduino via USB (Chrome/Edge only)"
            className={`group px-6 py-2.5 rounded-full text-sm font-bold transition-all duration-300 border flex items-center gap-2 ${
              isArduinoConnected
                ? 'bg-success/20 text-success border-success/50 shadow-[0_0_20px_rgba(0,255,136,0.3)] hover:bg-success/30'
                : 'bg-surface border-surfaceBorder text-gray-400 hover:text-white hover:border-gray-500'
            }`}
          >
            <Usb className={`w-4 h-4 ${isArduinoConnected ? 'text-success animate-pulse' : 'text-gray-500 group-hover:text-success transition-colors'}`} />
            {isArduinoConnected ? 'ARDUINO ON' : 'CONNECT ARDUINO'}
          </button>
          
          {/* User Profile & Logout */}
          <div className="flex items-center gap-4 ml-2 border-l border-surfaceBorder pl-6">
            <div className="flex flex-col items-end hidden sm:flex">
              <span className="text-sm font-bold text-white">{user?.full_name}</span>
              <span className="text-xs text-gray-400">{user?.email}</span>
            </div>
            <button
              onClick={logout}
              className="p-2.5 rounded-full bg-surface border border-surfaceBorder text-gray-400 hover:text-danger hover:border-danger hover:bg-danger/10 transition-colors"
              title="Logout"
            >
              <Power className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 grid grid-cols-1 lg:grid-cols-4 gap-6 relative z-10">
        <div className="lg:col-span-3 flex flex-col gap-6">
          <div className="glass-panel p-1 flex flex-col flex-1 min-h-[420px] relative overflow-hidden group">
            <div className="absolute inset-0 bg-grid-pattern opacity-40 pointer-events-none rounded-3xl z-0" />
            
            <div id="ecg-chart-container" className="relative z-10 bg-black/40 m-1 rounded-[22px] p-6 flex flex-col h-full border border-white/5">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-2xl font-bold flex items-center gap-3 text-white">
                  <ActivitySquare className="text-primary w-6 h-6" /> 
                  ECG Trace <span className="text-sm font-medium text-gray-400 ml-2 px-2 py-0.5 bg-surface rounded-md">Lead II</span>
                </h2>
                <label data-html2canvas-ignore className="flex items-center gap-3 cursor-pointer bg-surface/50 px-4 py-2 rounded-xl border border-surfaceBorder hover:bg-surface transition-colors">
                  <input type="checkbox" checked={isFiltering} onChange={toggleFilter} className="accent-primary w-5 h-5 cursor-pointer" />
                  <span className="font-semibold text-gray-200">Smart DSP Filter</span>
                </label>
              </div>
              
              <div className="flex-1 -ml-4 mt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={ecgData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="ecgGradient" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#00F0FF" stopOpacity={0.4} />
                        <stop offset="50%" stopColor="#00F0FF" stopOpacity={1} />
                        <stop offset="100%" stopColor="#00F0FF" stopOpacity={1} />
                      </linearGradient>
                      <filter id="glow">
                        <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
                        <feMerge>
                          <feMergeNode in="coloredBlur"/>
                          <feMergeNode in="SourceGraphic"/>
                        </feMerge>
                      </filter>
                    </defs>
                    
                    <CartesianGrid stroke="rgba(0, 240, 255, 0.1)" strokeDasharray="3 3" vertical={true} horizontal={true} />
                    <XAxis dataKey="time" type="number" domain={['dataMin', 'dataMax']} hide />
                    <YAxis domain={[-1.5, 2.5]} hide />
                    
                    {!isFiltering && (
                      <Line type="monotone" dataKey="raw" stroke="#4B5563" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                    )}
                    
                    <Line type="monotone" dataKey={isFiltering ? "filtered" : "raw"} stroke={isFiltering ? "url(#ecgGradient)" : "#60A5FA"} strokeWidth={3} dot={false} isAnimationActive={false} filter={isFiltering ? "url(#glow)" : ""} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="glass-panel p-6 flex flex-col gap-4 h-[250px] relative overflow-hidden">
            <h2 className="text-xl font-bold text-gray-200 z-10 relative">Heart Rate Variability (RR Trend)</h2>
            <div className="flex-1 -ml-6 z-10 relative">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={rrTrend} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorRR" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#00FF88" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#00FF88" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(255,255,255,0.05)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="index" hide />
                  <YAxis domain={[0.4, 1.2]} tick={{fill: '#6B7280'}} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: 'rgba(21, 26, 34, 0.9)', border: '1px solid rgba(0, 255, 136, 0.5)', borderRadius: '12px' }} itemStyle={{ color: '#00FF88', fontWeight: 'bold' }} />
                  <Area type="monotone" dataKey="rr" stroke="#00FF88" strokeWidth={3} fillOpacity={1} fill="url(#colorRR)" isAnimationActive={true} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <div className="glass-panel p-8 flex flex-col items-center justify-center relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-32 h-32 bg-primary/10 rounded-full blur-3xl group-hover:bg-primary/20 transition-all duration-500" />
            
            <div className="absolute top-6 right-6">
              <Heart className={`w-8 h-8 ${isConnected && isRunning && heartRate > 0 ? 'text-danger animate-beat drop-shadow-[0_0_15px_rgba(255,0,60,0.8)]' : 'text-gray-600'}`} style={{ fill: isConnected && isRunning && heartRate > 0 ? '#FF003C' : 'transparent' }} />
            </div>
            
            <p className="text-gray-400 font-bold mb-3 uppercase tracking-[0.2em] text-sm z-10">Heart Rate</p>
            <div className="flex items-baseline gap-2 z-10">
              <span className={`text-8xl font-black font-mono tracking-tighter transition-all duration-300 ${heartRate > 0 ? 'text-white neon-text' : 'text-gray-700'}`}>
                {heartRate > 0 ? heartRate : '--'}
              </span>
              <span className="text-2xl text-primary font-bold">BPM</span>
            </div>
          </div>

          <div className={`glass-panel p-8 border-[3px] transition-all duration-500 ${statusBg} flex flex-col gap-3 relative overflow-hidden`}>
            {status !== "Normal" && status !== "Waiting" && (
               <div className="absolute inset-0 bg-warning/5 animate-pulse pointer-events-none" />
            )}
            <div className="flex items-center justify-between relative z-10">
              <p className="text-gray-300 font-bold uppercase tracking-[0.15em] text-sm">Patient Status</p>
              {status !== "Normal" && status !== "Waiting" && <AlertTriangle className="w-6 h-6 text-warning drop-shadow-[0_0_10px_rgba(255,184,0,0.8)]" />}
            </div>
            <h3 className={`text-[1.35rem] leading-tight font-black ${statusColor} relative z-10`}>{statusMessage}</h3>
          </div>

          <div className="glass-panel p-7 flex flex-col gap-6">
            <div className="group">
              <p className="text-gray-400 text-sm font-bold uppercase tracking-wider mb-2">Latest RR Interval</p>
              <div className="flex items-center gap-3">
                <span className="text-3xl font-black font-mono text-white group-hover:text-success transition-colors">{latestRR > 0 ? `${latestRR.toFixed(3)}` : '--'}</span>
                <span className="text-gray-500 font-bold">sec</span>
              </div>
            </div>
            
            <div className="h-px bg-gradient-to-r from-transparent via-surfaceBorder to-transparent w-full"></div>
            
            <div className="group">
              <p className="text-gray-400 text-sm font-bold uppercase tracking-wider mb-3">Signal Quality</p>
              <div className="flex items-center gap-4 bg-black/30 p-3 rounded-2xl border border-white/5">
                <div className="flex gap-1.5 items-end h-8">
                  <div className={`w-3 rounded-full transition-all duration-500 ${quality === "Good" || quality === "Moderate" || quality === "Poor" ? 'bg-success h-4 shadow-[0_0_10px_#00FF88]' : 'bg-gray-700 h-2'}`}></div>
                  <div className={`w-3 rounded-full transition-all duration-500 ${quality === "Good" || quality === "Moderate" ? 'bg-success h-6 shadow-[0_0_10px_#00FF88]' : 'bg-gray-700 h-2'}`}></div>
                  <div className={`w-3 rounded-full transition-all duration-500 ${quality === "Good" ? 'bg-success h-8 shadow-[0_0_10px_#00FF88]' : 'bg-gray-700 h-2'}`}></div>
                </div>
                <p className={`text-xl font-black ${quality === "Good" ? "text-success neon-text-success" : "text-gray-300"}`}>{quality}</p>
              </div>
            </div>
          </div>

          <div className="glass-panel p-6 mt-auto">
            <div className="flex flex-col gap-3">
              <button 
                onClick={exportPDF}
                disabled={isExporting}
                className="w-full py-4 mb-2 rounded-2xl font-bold text-lg flex items-center justify-center gap-3 transition-all duration-300 bg-white text-black hover:bg-gray-200 shadow-[0_0_20px_rgba(255,255,255,0.4)] hover:shadow-[0_0_30px_rgba(255,255,255,0.6)] disabled:opacity-50"
              >
                {isExporting ? <RefreshCw className="w-6 h-6 animate-spin" /> : <FileText className="w-6 h-6" />}
                {isExporting ? 'Generating...' : 'Export PDF Report'}
              </button>
            
              <button 
                onClick={toggleRun}
                className={`w-full py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all duration-300 transform active:scale-95 ${isRunning ? 'bg-surface border-2 border-danger text-danger hover:bg-danger/20 hover:shadow-[0_0_20px_rgba(255,0,60,0.3)]' : 'bg-primary text-black hover:bg-white hover:shadow-[0_0_30px_rgba(0,240,255,0.6)]'}`}
              >
                <Power className="w-5 h-5" />
                {isRunning ? 'Halt System' : 'Initialize System'}
              </button>
              <button 
                onClick={() => { setEcgData([]); setRrTrend([]); setHrHistory([]); setAlertHistory([]); }}
                className="w-full py-3 rounded-xl font-bold bg-transparent border border-surfaceBorder text-gray-400 hover:bg-white/5 hover:text-white flex items-center justify-center gap-2 transition-colors"
              >
                <RefreshCw className="w-4 h-4" /> Reset Metrics
              </button>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}
