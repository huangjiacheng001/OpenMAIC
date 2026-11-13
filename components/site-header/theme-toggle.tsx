'use client';

import { Sun, Moon, Monitor } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useTheme } from '@/lib/hooks/use-theme';
import { useI18n } from '@/lib/hooks/use-i18n';
import { cn } from '@/lib/utils';
import '@/components/workbench/workspace/pro-popover-scope.css';

const options = [
  { value: 'light', icon: Sun },
  { value: 'dark', icon: Moon },
  { value: 'system', icon: Monitor },
] as const;

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const { t } = useI18n();
  const ActiveIcon = options.find(({ value }) => value === theme)?.icon ?? Monitor;

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
            className,
          )}
          aria-label={t('settings.theme')}
        >
          <ActiveIcon className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="pro-theme-popover min-w-[140px]">
        <DropdownMenuRadioGroup value={theme}>
          {options.map(({ value, icon: Icon }) => (
            <DropdownMenuRadioItem
              key={value}
              value={value}
              onSelect={() => setTheme(value)}
              className={cn('gap-2', value === theme && 'bg-primary-soft text-primary-text')}
            >
              <Icon className="size-4" />
              {t(`settings.themeOptions.${value}`)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
