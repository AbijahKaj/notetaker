import { useEffect, useRef, useState } from "react";

interface MicVuMeterProps {
  active: boolean;
}

export function MicVuMeter({ active }: MicVuMeterProps) {
  const [level, setLevel] = useState(0);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!active) {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      cancelAnimationFrame(rafRef.current);
      setLevel(0);
      return;
    }

    let cancelled = false;
    let audioCtx: AudioContext | null = null;

    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        audioCtx = new AudioContext();
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);

        const tick = () => {
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (const v of data) {
            const n = (v - 128) / 128;
            sum += n * n;
          }
          const rms = Math.sqrt(sum / data.length);
          setLevel(rms);
          rafRef.current = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        setLevel(0);
      }
    })();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      cancelAnimationFrame(rafRef.current);
      void audioCtx?.close();
    };
  }, [active]);

  return (
    <div className="vu-meter" style={{ marginTop: 12 }}>
      <div
        className="vu-meter-fill"
        style={{ width: `${Math.min(level * 400, 100)}%` }}
      />
    </div>
  );
}
