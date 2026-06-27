import { useState, useRef } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import type { CoinSearchResult } from "@/types";

interface AssetAutocompleteProps {
  value: string;
  onChange: (coinId: string, symbol: string) => void;
  label: string;
  placeholder?: string;
  disabled?: boolean;
  filterIds?: string[];
}

export function AssetAutocomplete({
  value,
  onChange,
  label,
  placeholder = "Search asset...",
  disabled = false,
  filterIds,
}: AssetAutocompleteProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CoinSearchResult[]>([]);
  // Distinguishes a provider/network failure from a genuine no-match so the dropdown never blanks
  // silently (the failure mode that made the app look broken under the old rate-limited provider).
  const [loadError, setLoadError] = useState(false);
  const displayValue = value;
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  function handleSearch(q: string) {
    setQuery(q);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (q.length < 2) {
      setResults([]);
      setLoadError(false);
      return;
    }

    debounceRef.current = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(`/api/assets/search?q=${encodeURIComponent(q)}`);
          if (!res.ok) {
            setLoadError(true);
            return;
          }
          const data = (await res.json()) as { data: CoinSearchResult[] };
          let filtered = data.data.filter((c) => c.is_active);
          if (filterIds) {
            filtered = filtered.filter((c) => filterIds.includes(c.id));
          }
          setResults(filtered);
          setLoadError(false);
        } catch {
          setLoadError(true);
        }
      })();
    }, 300);
  }

  function handleSelect(coin: CoinSearchResult) {
    onChange(coin.id, coin.symbol);
    setQuery("");
    setResults([]);
    setOpen(false);
  }

  return (
    <div className="grid gap-1.5">
      <label className="text-sm font-medium">{label}</label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className="border-input bg-background ring-offset-background flex h-9 w-full items-center justify-between rounded-md border px-3 py-2 text-sm disabled:opacity-50"
          >
            <span className={displayValue ? "" : "text-muted-foreground"}>{displayValue || placeholder}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[300px] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput placeholder={placeholder} value={query} onValueChange={handleSearch} />
            <CommandList>
              <CommandEmpty>
                {query.length < 2
                  ? "Type to search..."
                  : loadError
                    ? "Couldn't load assets — try again"
                    : "No results found."}
              </CommandEmpty>
              <CommandGroup>
                {results.map((coin) => (
                  <CommandItem
                    key={coin.id}
                    onSelect={() => {
                      handleSelect(coin);
                    }}
                  >
                    <span className="font-medium">{coin.symbol}</span>
                    <span className="text-muted-foreground ml-2">{coin.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
