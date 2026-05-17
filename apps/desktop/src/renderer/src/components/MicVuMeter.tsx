import { useEffect, useState } from "react";
import { api } from "../desktop";

interface MicVuMeterProps {
  active: boolean;
}

/** Uses main-process mic levels — does not call getUserMedia (avoids a second macOS mic prompt). */
export function MicVuMeter({ active }: MicVuMeterProps) {
  const [level, setLevel] = useState(0);

  useEffect(() => {
    if (!active) {
      setLevel(0);
      return;
    }

    void api().invoke("micPreview:start");

    const unsub = api().on((evt) => {
      if (evt.type === "audio:level") {
        setLevel(evt.payload.rms);
      }
    });

    return () => {
      unsub();
      void api().invoke("micPreview:stop");
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
