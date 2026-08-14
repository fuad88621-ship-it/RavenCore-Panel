import React, { useEffect, useId, useState } from 'react';
import { cn } from './ui.jsx';

export default function NumberInput({
  value = 0,
  onChange,
  min,
  max,
  step,
  className = '',
  placeholder,
  required,
  disabled,
  label,
  allowEmpty = false,
  id,
  describedBy,
}) {
  const [focused, setFocused] = useState(false);
  const [raw, setRaw] = useState(String(value ?? ''));
  const defaultId = useId();
  const inputId = id || defaultId;
  const ariaLabel = label ? undefined : 'Number input';

  // Sync raw value with prop when not focused (controlled reset support).
  useEffect(() => {
    if (!focused) setRaw(value === undefined || value === null ? '' : String(value));
  }, [value, focused]);

  function parse(val) {
    const n = Number(val);
    if (Number.isNaN(n)) return undefined;
    return n;
  }

  function commit(n) {
    if (n === undefined) return;
    if (min !== undefined && n < min) n = min;
    if (max !== undefined && n > max) n = max;
    setRaw(String(n));
    onChange?.(n);
  }

  function handleChange(e) {
    let v = e.target.value;

    // Allow empty state so users can clear the field.
    if (v === '') {
      setRaw('');
      if (allowEmpty) onChange?.(undefined);
      return;
    }

    // Allow typing a negative sign without immediately converting to 0.
    if (v === '-') {
      setRaw('-');
      return;
    }

    // Strip leading zeros (e.g. 019 -> 19) while preserving decimals (0.5, 05.5).
    if (v.length > 1 && v.startsWith('0') && !v.startsWith('0.') && !v.includes('.')) {
      v = v.replace(/^0+/, '');
    }

    const n = parse(v);
    if (n !== undefined) {
      let clamped = n;
      if (min !== undefined && clamped < min) clamped = min;
      if (max !== undefined && clamped > max) clamped = max;
      setRaw(String(clamped));
      onChange?.(clamped);
    }
  }

  function handleBlur() {
    setFocused(false);
    if (raw === '' || raw === '-') {
      if (allowEmpty) {
        onChange?.(undefined);
        return;
      }
      const fallback = min !== undefined && min > 0 ? min : 0;
      setRaw(String(fallback));
      onChange?.(fallback);
      return;
    }
    const n = parse(raw);
    if (n === undefined) return;
    commit(n);
  }

  function stepBy(delta) {
    if (disabled) return;
    const current = parse(raw) ?? value ?? 0;
    const s = step ?? 1;
    const next = Math.round((current + delta * s) * 1000) / 1000;
    commit(next);
  }

  function handleKeyDown(e) {
    if (e.key === 'ArrowUp') { e.preventDefault(); stepBy(1); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); stepBy(-1); }
    else if (e.key === 'Home') { e.preventDefault(); if (min !== undefined) commit(min); }
    else if (e.key === 'End') { e.preventDefault(); if (max !== undefined) commit(max); }
  }

  const invalid = raw !== '' && raw !== '-' && parse(raw) === undefined;

  return (
    <div className={cn('relative flex items-center', className)}>
      {label && (
        <label htmlFor={inputId} className="sr-only">
          {label}
        </label>
      )}
      <input
        id={inputId}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={step}
        className="input w-full"
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        value={raw}
        aria-label={ariaLabel}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        onFocus={() => setFocused(true)}
        onChange={handleChange}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
      />
      <div className="absolute right-1 top-1/2 hidden -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-white/[0.08] bg-[#0c0c10] sm:flex">
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled || (max !== undefined && parse(raw) >= max)}
          onClick={() => stepBy(1)}
          className="px-2 py-0.5 text-xs text-zinc-400 transition hover:bg-white/[0.05] hover:text-white disabled:opacity-40"
          aria-hidden="true"
        >
          ▲
        </button>
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled || (min !== undefined && parse(raw) <= min)}
          onClick={() => stepBy(-1)}
          className="px-2 py-0.5 text-xs text-zinc-400 transition hover:bg-white/[0.05] hover:text-white disabled:opacity-40"
          aria-hidden="true"
        >
          ▼
        </button>
      </div>
    </div>
  );
}
