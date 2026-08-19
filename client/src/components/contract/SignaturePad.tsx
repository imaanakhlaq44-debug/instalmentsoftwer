import React, { useEffect, useRef, useState } from 'react';

/**
 * Where the customer signs.
 *
 * A plain canvas, drawn with pointer events so a finger on a counter tablet, a
 * stylus and a mouse all work without three code paths. It exports a PNG data
 * URL — nothing about the strokes is kept, only the resulting image, which is
 * what a signature is.
 *
 * The canvas is sized to its rendered box multiplied by the device pixel ratio,
 * because a canvas at CSS size on a phone screen produces a signature that
 * looks like it was drawn with a marker pen.
 */
export const SignaturePad: React.FC<{
  onChange: (dataUrl: string | null) => void;
  disabled?: boolean;
}> = ({ onChange, disabled }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ratio = window.devicePixelRatio || 1;
    const box = canvas.getBoundingClientRect();
    canvas.width = box.width * ratio;
    canvas.height = box.height * ratio;

    const context = canvas.getContext('2d');
    if (!context) return;
    context.scale(ratio, ratio);
    context.lineWidth = 2;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = '#0f172a';
  }, []);

  const positionOf = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };

  const start = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    const context = canvasRef.current?.getContext('2d');
    if (!context) return;

    // Capture the pointer so a stroke that leaves the box still ends cleanly
    // rather than leaving the pad stuck in a drawing state.
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;

    const { x, y } = positionOf(event);
    context.beginPath();
    context.moveTo(x, y);
  };

  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || disabled) return;
    const context = canvasRef.current?.getContext('2d');
    if (!context) return;

    const { x, y } = positionOf(event);
    context.lineTo(x, y);
    context.stroke();

    if (!hasInk) setHasInk(true);
  };

  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;

    const canvas = canvasRef.current;
    if (!canvas) return;
    onChange(hasInk ? canvas.toDataURL('image/png') : null);
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    context.clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
    onChange(null);
  };

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        onPointerCancel={end}
        // touch-none stops the browser scrolling the page while somebody signs.
        className={`w-full h-40 rounded-2xl border-2 border-dashed bg-white touch-none ${
          disabled ? 'border-slate-200 opacity-60' : 'border-slate-300 cursor-crosshair'
        }`}
        aria-label="Signature area"
      />
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-slate-500">
          {hasInk ? 'Signature captured.' : 'Ask the customer to sign above.'}
        </span>
        <button
          type="button"
          onClick={clear}
          disabled={disabled || !hasInk}
          className="text-[11px] font-bold text-slate-600 hover:text-slate-900 disabled:opacity-40"
        >
          Clear
        </button>
      </div>
    </div>
  );
};
