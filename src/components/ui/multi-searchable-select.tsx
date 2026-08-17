import { useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import type { SearchableOption } from "@/components/ui/searchable-select";

export function MultiSearchableSelect({
  values,
  onValuesChange,
  options,
  placeholder = "Sélectionner…",
  emptyLabel = "Aucun résultat",
  searchPlaceholder = "Rechercher…",
  triggerClassName,
  className,
  disabled,
  clearable = true,
}: {
  values: string[];
  onValuesChange: (v: string[]) => void;
  options: SearchableOption[];
  placeholder?: string;
  emptyLabel?: string;
  searchPlaceholder?: string;
  triggerClassName?: string;
  className?: string;
  disabled?: boolean;
  /** Show a "clear all" button when at least one value is selected. */
  clearable?: boolean;
}) {
  const { tr } = useI18n();
  const [open, setOpen] = useState(false);
  const selectedOpts = useMemo(
    () => values.map((v) => options.find((o) => o.value === v) ?? {
      value: v,
      label: tr("Valeur déjà assignée"),
    }),
    [values, options],
  );
  const toggle = (v: string) => {
    if (values.includes(v)) onValuesChange(values.filter((x) => x !== v));
    else onValuesChange([...values, v]);
  };
  const remove = (v: string) => onValuesChange(values.filter((x) => x !== v));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "w-full justify-between font-normal h-auto min-h-9 py-1.5",
            selectedOpts.length === 0 && "text-muted-foreground",
            triggerClassName,
          )}
        >
          <div className="flex flex-wrap gap-1 text-left flex-1 min-w-0">
            {selectedOpts.length === 0 && <span className="truncate">{tr(placeholder)}</span>}
            {selectedOpts.map((o) => (
              <Badge key={o.value} variant="secondary" className="gap-1 max-w-full">
                <span className="truncate">{o.label}</span>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => { e.stopPropagation(); remove(o.value); }}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); remove(o.value); } }}
                  className="opacity-70 hover:opacity-100"
                  aria-label={`${tr("Retirer")} ${o.label}`}
                >
                  <X className="h-3 w-3" />
                </span>
              </Badge>
            ))}
          </div>
          <span className="flex items-center gap-1 shrink-0 ml-2">
            {clearable && values.length > 0 && (
              <span
                role="button"
                tabIndex={0}
                aria-label={tr("Tout effacer")}
                title={tr("Tout effacer")}
                onClick={(e) => { e.stopPropagation(); onValuesChange([]); }}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onValuesChange([]); } }}
                className="rounded p-0.5 opacity-60 hover:opacity-100 hover:bg-muted"
              >
                <X className="h-3.5 w-3.5" />
              </span>
            )}
            <ChevronsUpDown className="h-4 w-4 opacity-50" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className={cn("p-0", className)} align="start" style={{ width: "var(--radix-popover-trigger-width)" }}>
        <Command
          filter={(itemValue, search) => {
            const opt = options.find((o) => o.value === itemValue);
            const hay = `${opt?.label ?? ""} ${opt?.hint ?? ""}`.toLowerCase();
            return hay.includes(search.toLowerCase()) ? 1 : 0;
          }}
        >
          <CommandInput placeholder={tr(searchPlaceholder)} />
          <CommandList>
            <CommandEmpty>{tr(emptyLabel)}</CommandEmpty>
            <CommandGroup>
              {options.map((o) => {
                const active = values.includes(o.value);
                return (
                  <CommandItem key={o.value} value={o.value} onSelect={() => toggle(o.value)}>
                    <Check className={cn("mr-2 h-4 w-4", active ? "opacity-100" : "opacity-0")} />
                    <span className="truncate">{o.label}</span>
                    {o.hint && <span className="ml-auto text-xs text-muted-foreground truncate pl-2">{o.hint}</span>}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}