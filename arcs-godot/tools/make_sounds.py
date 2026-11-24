#!/usr/bin/env python3
"""Sons du ski, synthétisés (aucun enregistrement tiers) : boucles sans couture et bruits ponctuels.
Sortie : sounds/*.wav, 44,1 kHz mono 16 bits."""
import numpy as np, wave, os
from scipy.signal import butter, sosfilt
SR = 44100
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'sounds')
rng = np.random.default_rng(7)

def band(x, lo, hi, order=4):
    if lo <= 0: sos = butter(order, hi, 'low', fs=SR, output='sos')
    elif hi >= SR / 2: sos = butter(order, lo, 'high', fs=SR, output='sos')
    else: sos = butter(order, [lo, hi], 'band', fs=SR, output='sos')
    return sosfilt(sos, x)

def pink(n):
    w = rng.standard_normal(n); f = np.fft.rfft(w); k = np.arange(len(f)); k[0] = 1
    return np.fft.irfft(f / np.sqrt(k), n)

def loop(x, fade=0.25):
    """boucle sans couture : fondu enchaîné de la fin sur le début"""
    m = int(fade * SR); a = np.linspace(0, 1, m)
    y = x[m:].copy(); y[-m:] = y[-m:] * (1 - a) + x[:m] * a
    return y

def slow(n, rate, depth):
    t = np.arange(n) / SR
    s = sum(np.sin(2 * np.pi * rate * k * t + rng.uniform(0, 6.28)) / k for k in (1, 2.3, 4.1))
    return 1 + depth * s / 1.6

def save(name, x, gain=0.8):
    x = x / (np.max(np.abs(x)) + 1e-9) * gain
    with wave.open(os.path.join(OUT, name), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype(np.int16).tobytes())
    print(name, len(x) / SR, 's')

N = SR * 5
# vent de vitesse : bruit rose filtré, rafales lentes
w = band(pink(N + SR), 60, 1400) * slow(N + SR, 0.35, 0.5)
save('wind.wav', loop(w))
# carving : sifflement aigu de la carre dans la neige damée + grain fin
c = band(rng.standard_normal(N + SR), 1800, 7000) * slow(N + SR, 1.7, 0.35)
grain = band((rng.random(N + SR) < 0.004).astype(float) * rng.standard_normal(N + SR), 2500, 9000) * 3
save('carve.wav', loop(c + grain), 0.7)
# dérapage : raclement large bande, rugueux (modulation rapide)
r = band(rng.standard_normal(N + SR), 300, 5000) * (0.6 + 0.4 * np.abs(band(rng.standard_normal(N + SR), 0, 30)) * 8)
r += band(rng.standard_normal(N + SR), 80, 400) * 0.6
save('scrape.wav', loop(r), 0.75)
# poudreuse : souffle grave et doux
p = band(pink(N + SR), 120, 900) * slow(N + SR, 0.9, 0.45)
save('powder.wav', loop(p), 0.7)
# ambiance de montagne : vent lointain très doux, quelques sifflements de rafale
a = band(pink(SR * 12 + SR), 40, 600) * slow(SR * 12 + SR, 0.08, 0.7)
a += band(rng.standard_normal(SR * 12 + SR), 1500, 3500) * 0.05 * np.clip(slow(SR * 12 + SR, 0.05, 1.2) - 1.3, 0, 1)
save('ambience.wav', loop(a, 1.0), 0.6)
# bruits ponctuels
def env(n, att, dec):
    t = np.arange(n) / SR
    return np.minimum(1, t / att) * np.exp(-t / dec)
n = int(SR * 0.35)
save('pole.wav', band(rng.standard_normal(n), 900, 6000) * env(n, 0.002, 0.05) + band(rng.standard_normal(n), 150, 700) * env(n, 0.004, 0.08) * 0.5, 0.6)
n = int(SR * 0.6)
save('land.wav', band(rng.standard_normal(n), 60, 500) * env(n, 0.005, 0.12) + band(rng.standard_normal(n), 800, 5000) * env(n, 0.003, 0.18) * 0.6, 0.85)
n = int(SR * 1.4)
save('crash.wav', band(rng.standard_normal(n), 50, 2500) * env(n, 0.01, 0.35) * (1 + 0.6 * np.sin(np.arange(n) / SR * 2 * np.pi * 7)), 0.9)
