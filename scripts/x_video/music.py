"""The track under the vertical video: bouncy and electronic, 120 bpm in C, with
a pop on each tap and move in the picture (their seconds follow the length). Standard library only.

    python3 scripts/x_video/music.py out.wav [seconds [cut ...]]
"""
import math
import random
import struct
import sys
import wave

RATE = 44100
BEAT = 0.5
# C, Am, F, G: the bass root and the three notes the pluck plays.
CHORDS = [(65.41, (523.25, 659.25, 783.99)), (55.0, (440.0, 523.25, 659.25)),
          (43.65, (349.23, 440.0, 523.25)), (49.0, (392.0, 493.88, 587.33))]
ARP = [0, 2, 1, 2, 0, 2, 1, 2]
# The tune over the top, in sixteenths of a bar: (step, note of C major pentatonic, octaves up).
PENTA = [523.25, 587.33, 659.25, 783.99, 880.0]
RIFF = [[(0, 2, 0), (3, 3, 0), (6, 4, 0), (8, 3, 0), (11, 2, 0), (14, 0, 1)],
        [(0, 4, 0), (3, 3, 0), (6, 2, 0), (8, 0, 0), (10, 2, 0), (12, 3, 0)],
        [(0, 0, 1), (3, 4, 0), (6, 3, 0), (8, 4, 0), (11, 0, 1), (14, 1, 1)],
        [(0, 3, 0), (2, 3, 0), (4, 4, 0), (6, 0, 1), (8, 1, 1), (12, 3, 1)]]


def main(path, seconds, cuts=()):
    n = int(seconds * RATE)
    out = [0.0] * n
    rnd = random.Random(7)

    def add(at, length, fn):
        start = int(at * RATE)
        for i in range(min(int(length * RATE), n - start)):
            out[start + i] += fn(i / RATE)

    def kick(at):
        add(at, 0.22, lambda t: 0.95 * math.exp(-t * 15) * math.sin(2 * math.pi * (45 * t + 80 * (1 - math.exp(-t * 30)) / 30)))

    def noise(at, length, gain):
        add(at, length, lambda t: gain * math.exp(-t * 5 / length) * rnd.uniform(-1, 1))

    def clap(at):
        for d in (0, 0.011, 0.023):
            noise(at + d, 0.09, 0.2)

    def tone(at, freq, length, gain, bright):
        add(at, length, lambda t: gain * math.exp(-t * 4 / length) * (
            math.sin(2 * math.pi * freq * t) + bright * math.sin(4 * math.pi * freq * t) + bright / 2 * math.sin(6 * math.pi * freq * t)))

    def bass(at, freq):
        # A rubbery bass: the pitch drops into the note and a square-ish edge gives it bounce.
        add(at, 0.21, lambda t: 0.34 * min(1, t * 200) * math.exp(-t * 9) * math.tanh(
            2.2 * math.sin(2 * math.pi * freq * (t + 0.012 * math.exp(-t * 40)))))

    def pop(at, high=False):
        base = 700 if high else 480
        add(at, 0.08, lambda t: 0.5 * math.exp(-t * 38) * math.sin(2 * math.pi * (base * t + 6500 * t * t)))

    def rise(at, length):
        add(at, length, lambda t: 0.16 * (t / length) ** 2 * rnd.uniform(-1, 1))

    bars = int(seconds / (4 * BEAT))
    # Quiet first bar, the drums in from the second, the tune from the fifth
    # (when the phone comes up), a thinner stretch near the end and one chord to finish.
    for bar in range(bars):
        at, (root, notes) = bar * 4 * BEAT, CHORDS[bar % 4]
        last = bar == bars - 1
        long = bars > 16
        thin = long and bar in (14, 15)
        full = bar >= (4 if long else 2) and not thin and not last
        if not cuts:
            pop(at)
        if bar in ((3, 15) if long else (bars - 3,)):
            rise(at, 4 * BEAT)
        for beat in range(4):
            b = at + beat * BEAT
            if bar >= 1 and not thin and not (last and beat):
                kick(b)
            if bar >= 2 and beat % 2 and not last:
                clap(b)
            if bar >= 1 and not last:
                noise(b + BEAT / 2, 0.035, 0.1)
                bass(b + BEAT / 2, root * 2)
            if full:
                noise(b + BEAT / 4, 0.02, 0.05)
                noise(b + 3 * BEAT / 4, 0.02, 0.05)
                bass(b + 3 * BEAT / 4, root * (3 if beat == 3 else 4))
            if bar >= 2 and not last and not thin:
                bass(b, root)
        for step in range(8):
            if last and step:
                break
            octave = 2 if bar % 4 == 3 and step > 5 else 1
            tone(at + step * BEAT / 2, notes[ARP[step]] * octave, 0.2, 0.1 if full else 0.13, 0.25)
        if full or thin:
            for step, note, octave in RIFF[bar % 4]:
                tone(at + step * BEAT / 4, PENTA[note] * (2 ** octave), 0.26, 0.11 if thin else 0.15, 0.55)
                pop(at + step * BEAT / 4, True) if step in (6, 14) and full else None
        if last:
            for f in notes:
                tone(at, f, 1.7, 0.14, 0.3)
            tone(at, root * 2, 1.7, 0.3, 0.4)

    for at in cuts:
        pop(at)

    fade = int(0.3 * RATE)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(b"".join(struct.pack("<h", int(30000 * math.tanh(1.05 * v) * min(1.0, (n - i) / fade)))
                               for i, v in enumerate(out)))


if __name__ == "__main__":
    main(sys.argv[1], float(sys.argv[2]) if len(sys.argv) > 2 else 22, [float(a) for a in sys.argv[3:]])
