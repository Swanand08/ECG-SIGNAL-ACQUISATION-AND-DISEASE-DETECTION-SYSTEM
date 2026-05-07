import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { HeartPulse, Eye, EyeOff, Lock, Mail, User, AlertCircle, CheckCircle2 } from 'lucide-react';

export default function Signup() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    if (password.length < 8) {
      setError('Password must be at least 8 characters long');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch('http://localhost:8000/signup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ full_name: fullName, email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || 'Failed to register');
      }

      setSuccess(true);
      setTimeout(() => {
        navigate('/login');
      }, 2000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen p-4 flex items-center justify-center relative overflow-hidden">
      <div className="absolute top-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-primary/10 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] left-[-10%] w-[40%] h-[40%] rounded-full bg-purple/10 blur-[120px] pointer-events-none" />

      <div className="glass-panel p-8 w-full max-w-md relative z-10 overflow-hidden rounded-[30px]">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-success via-primary to-purple" />
        
        <div className="flex flex-col items-center mb-8 mt-2">
          <div className="p-3 bg-primary/20 rounded-2xl mb-4">
            <HeartPulse className="text-primary w-10 h-10" />
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white neon-text text-center">
            VitalSync<span className="font-light text-primary/80">Pro</span>
          </h1>
          <p className="text-gray-400 mt-2">Register new clinical personnel</p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-danger/10 border border-danger/30 rounded-xl flex items-center gap-3 text-danger">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <p className="text-sm font-medium">{error}</p>
          </div>
        )}

        {success && (
          <div className="mb-6 p-4 bg-success/10 border border-success/30 rounded-xl flex items-center gap-3 text-success">
            <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
            <p className="text-sm font-medium">Registration successful! Redirecting to login...</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-bold text-gray-400 mb-2 uppercase tracking-wider">Full Name</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <User className="h-5 w-5 text-gray-500" />
              </div>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="block w-full pl-11 pr-4 py-3 bg-black/40 border border-surfaceBorder rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
                placeholder="Dr. Jane Doe"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-400 mb-2 uppercase tracking-wider">Email Address</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <Mail className="h-5 w-5 text-gray-500" />
              </div>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="block w-full pl-11 pr-4 py-3 bg-black/40 border border-surfaceBorder rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
                placeholder="doctor@hospital.com"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-400 mb-2 uppercase tracking-wider">Password</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <Lock className="h-5 w-5 text-gray-500" />
              </div>
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="block w-full pl-11 pr-12 py-3 bg-black/40 border border-surfaceBorder rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
                placeholder="Min. 8 characters"
              />
              <button
                type="button"
                className="absolute inset-y-0 right-0 pr-4 flex items-center"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? (
                  <EyeOff className="h-5 w-5 text-gray-400 hover:text-white transition-colors" />
                ) : (
                  <Eye className="h-5 w-5 text-gray-400 hover:text-white transition-colors" />
                )}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-400 mb-2 uppercase tracking-wider">Confirm Password</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <Lock className="h-5 w-5 text-gray-500" />
              </div>
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="block w-full pl-11 pr-4 py-3 bg-black/40 border border-surfaceBorder rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
                placeholder="Confirm your password"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading || success}
            className="w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-2 transition-all duration-300 bg-white text-black hover:bg-gray-200 shadow-[0_0_20px_rgba(255,255,255,0.4)] hover:shadow-[0_0_30px_rgba(255,255,255,0.6)] disabled:opacity-70 disabled:cursor-not-allowed mt-6"
          >
            {isLoading ? (
              <div className="w-6 h-6 border-2 border-black border-t-transparent rounded-full animate-spin" />
            ) : (
              'Create Account'
            )}
          </button>
        </form>

        <p className="mt-8 text-center text-gray-400 text-sm">
          Already registered?{' '}
          <Link to="/login" className="font-bold text-white hover:text-primary transition-colors">
            Sign In Instead
          </Link>
        </p>
      </div>
    </div>
  );
}
