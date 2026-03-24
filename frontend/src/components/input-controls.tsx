"use client";

import { useRef } from "react";

type NumberStepperInputProps = {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  required?: boolean;
  wrapperClassName?: string;
  inputClassName?: string;
  buttonClassName?: string;
  ariaLabel?: string;
};

function clampNumber(value: number, min?: number, max?: number) {
  let next = value;
  if (typeof min === "number") next = Math.max(min, next);
  if (typeof max === "number") next = Math.min(max, next);
  return next;
}

export function NumberStepperInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  required = false,
  wrapperClassName = "",
  inputClassName = "",
  buttonClassName = "",
  ariaLabel = "number input",
}: NumberStepperInputProps) {
  function applyDelta(delta: number) {
    const next = clampNumber(value + delta, min, max);
    onChange(next);
  }

  function handleRawChange(raw: string) {
    if (raw.trim() === "") {
      onChange(typeof min === "number" ? min : 0);
      return;
    }
    const parsed = Number(raw);
    if (Number.isNaN(parsed)) return;
    onChange(clampNumber(parsed, min, max));
  }

  const buttonBase =
    "h-3.5 w-6 rounded border border-slate-500/70 bg-slate-900/95 text-[10px] leading-none text-slate-200 transition hover:border-cyan-300/60 hover:text-cyan-100";

  return (
    <div className={`relative ${wrapperClassName}`}>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        required={required}
        onChange={(e) => handleRawChange(e.target.value)}
        aria-label={ariaLabel}
        className={inputClassName}
      />
      <div className="pointer-events-none absolute inset-y-1 right-1.5 flex items-center">
        <div className="pointer-events-auto flex flex-col gap-0.5">
          <button
            type="button"
            onClick={() => applyDelta(step)}
            className={`${buttonBase} ${buttonClassName}`}
            aria-label={`Increase ${ariaLabel}`}
          >
            +
          </button>
          <button
            type="button"
            onClick={() => applyDelta(-step)}
            className={`${buttonBase} ${buttonClassName}`}
            aria-label={`Decrease ${ariaLabel}`}
          >
            -
          </button>
        </div>
      </div>
    </div>
  );
}

type DateTimeInputProps = {
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  wrapperClassName?: string;
  inputClassName?: string;
  buttonClassName?: string;
  ariaLabel?: string;
};

export function DateTimeInput({
  value,
  onChange,
  required = false,
  wrapperClassName = "",
  inputClassName = "",
  buttonClassName = "",
  ariaLabel = "datetime input",
}: DateTimeInputProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  function openPicker() {
    const input = inputRef.current;
    if (!input) return;
    try {
      const pickerCapable = input as HTMLInputElement & { showPicker?: () => void };
      if (pickerCapable.showPicker) {
        pickerCapable.showPicker();
        return;
      }
    } catch {
      // Fallback below
    }
    input.focus();
    input.click();
  }

  return (
    <div className={`relative ${wrapperClassName}`}>
      <input
        ref={inputRef}
        type="datetime-local"
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel}
        className={`custom-datetime ${inputClassName}`}
      />
      <button
        type="button"
        onClick={openPicker}
        className={`absolute right-2 top-1/2 -translate-y-1/2 rounded border border-slate-500/70 bg-slate-900/95 p-1.5 text-slate-200 transition hover:border-cyan-300/60 hover:text-cyan-100 ${buttonClassName}`}
        aria-label="Open calendar"
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M8 2v4" />
          <path d="M16 2v4" />
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M3 10h18" />
        </svg>
      </button>
    </div>
  );
}
