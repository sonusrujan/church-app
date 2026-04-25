import { useState, useRef, useEffect, useCallback } from "react";

export type SearchSelectOption = {
  id: string;
  label: string;
  sub?: string;
};

type Props = {
  /** Async function that returns options for the given query */
  onSearch: (query: string) => Promise<SearchSelectOption[]>;
  /** Called when user selects an option */
  onSelect: (option: SearchSelectOption) => void;
  /** Currently selected display label */
  value: string;
  /** Called when cleared */
  onClear?: () => void;
  placeholder?: string;
  disabled?: boolean;
  /** Minimum characters before searching */
  minChars?: number;
  /** Debounce delay in ms */
  debounce?: number;
};

export default function SearchSelect({
  onSearch,
  onSelect,
  value,
  onClear,
  placeholder = "Type to search...",
  disabled = false,
  minChars = 2,
  debounce = 300,
}: Props) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<SearchSelectOption[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [focusIndex, setFocusIndex] = useState(-1);
  const [selectedLabel, setSelectedLabel] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const doSearch = useCallback(
    async (q: string) => {
      if (q.length < minChars) {
        setOptions([]);
        setOpen(false);
        return;
      }
      setLoading(true);
      try {
        const results = await onSearch(q);
        setOptions(results);
        setOpen(results.length > 0);
        setFocusIndex(-1);
      } catch {
        setOptions([]);
        setOpen(false);
      } finally {
        setLoading(false);
      }
    },
    [onSearch, minChars],
  );

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setQuery(val);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doSearch(val), debounce);
  }

  function handleSelect(opt: SearchSelectOption) {
    setSelectedLabel(opt.label);
    onSelect(opt);
    setQuery("");
    setOptions([]);
    setOpen(false);
  }

  function handleClear() {
    setQuery("");
    setSelectedLabel("");
    setOptions([]);
    setOpen(false);
    onClear?.();
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusIndex((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && focusIndex >= 0) {
      e.preventDefault();
      handleSelect(options[focusIndex]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Cleanup timer
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  // Reset selectedLabel when value is cleared externally
  useEffect(() => { if (!value) setSelectedLabel(""); }, [value]);

  // If selected, show the selection chip
  if (value) {
    return (
      <div className="search-select" ref={containerRef}>
        <div className="search-select-selected">
          <span className="search-select-chip">{selectedLabel || value}</span>
          {!disabled && (
            <button type="button" className="btn-ghost search-select-clear" onClick={handleClear} aria-label="Clear selection">
              ✕
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="search-select" ref={containerRef}>
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onFocus={() => { if (options.length) setOpen(true); }}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-autocomplete="list"
      />
      {loading && <span className="search-select-spinner" />}
      {open && (
        <ul className="search-select-dropdown" role="listbox">
          {options.map((opt, idx) => (
            <li
              key={opt.id}
              role="option"
              aria-selected={idx === focusIndex}
              className={`search-select-option${idx === focusIndex ? " focused" : ""}`}
              onMouseDown={(e) => { e.preventDefault(); handleSelect(opt); }}
              onMouseEnter={() => setFocusIndex(idx)}
            >
              <span className="search-select-option-label">{opt.label}</span>
              {opt.sub ? <span className="search-select-option-sub">{opt.sub}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
