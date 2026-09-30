"use client";

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "@/lib/utils";

// ─── Provider ────────────────────────────────────────────────────────────────
// Envolve a árvore que precisa de tooltips. O delayDuration padrão do Radix
// é 700ms — reduzimos para 300ms que é mais responsivo para uso interno.
// Coloque o TooltipProvider uma vez no root da aplicação (ex: App.tsx ou
// o layout raiz do TanStack Router) e não precisa repetir nos componentes.

const TooltipProvider = TooltipPrimitive.Provider;

// ─── Root ─────────────────────────────────────────────────────────────────────

const Tooltip = TooltipPrimitive.Root;

// ─── Trigger ─────────────────────────────────────────────────────────────────

const TooltipTrigger = TooltipPrimitive.Trigger;

// ─── Content ─────────────────────────────────────────────────────────────────

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        // Base
        "z-50 overflow-hidden rounded-md px-3 py-1.5",
        // Tipografia
        "text-xs text-popover-foreground",
        // Fundo — usa as mesmas variáveis CSS do projeto (popover = card escuro em dark mode)
        "bg-popover shadow-md border border-border",
        // Animações de entrada/saída (Radix injeta data-state)
        "animate-in fade-in-0 zoom-in-95",
        "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
        // Direções de slide
        "data-[side=bottom]:slide-in-from-top-2",
        "data-[side=left]:slide-in-from-right-2",
        "data-[side=right]:slide-in-from-left-2",
        "data-[side=top]:slide-in-from-bottom-2",
        className
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };