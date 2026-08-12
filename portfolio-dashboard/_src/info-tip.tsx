"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { MdInfoOutline } from "react-icons/md";

export type InfoTipProps = {
  text?: string;
  formula?: string;
  method?: string;
  interpretation?: string;
  label?: string;
  align?: "start" | "center" | "end";
  placement?: "top" | "bottom";
};

export function InfoTip({
  text,
  formula,
  method,
  interpretation,
  label = "Metric definition",
  align = "center",
  placement = "bottom",
}: InfoTipProps) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{
    top: number;
    left: number;
    arrowLeft: number;
    side: "top" | "bottom";
  } | null>(null);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    const tooltip = tooltipRef.current;
    if (!trigger || !tooltip) return;

    const triggerRect = trigger.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const viewportPadding = 12;
    const gap = 10;
    const center = triggerRect.left + triggerRect.width / 2;
    const topSpace = triggerRect.top - viewportPadding;
    const bottomSpace = window.innerHeight - triggerRect.bottom - viewportPadding;
    let side = placement;

    if (side === "top" && tooltipRect.height + gap > topSpace && bottomSpace > topSpace) side = "bottom";
    if (side === "bottom" && tooltipRect.height + gap > bottomSpace && topSpace > bottomSpace) side = "top";

    let left = center - tooltipRect.width / 2;
    if (align === "start") left = triggerRect.left - 6;
    if (align === "end") left = triggerRect.right - tooltipRect.width + 6;
    left = Math.min(
      Math.max(left, viewportPadding),
      Math.max(viewportPadding, window.innerWidth - tooltipRect.width - viewportPadding),
    );

    const desiredTop = side === "top"
      ? triggerRect.top - tooltipRect.height - gap
      : triggerRect.bottom + gap;
    const top = Math.min(
      Math.max(desiredTop, viewportPadding),
      Math.max(viewportPadding, window.innerHeight - tooltipRect.height - viewportPadding),
    );
    const arrowLeft = Math.min(Math.max(center - left, 14), tooltipRect.width - 14);
    setPosition({ top, left, arrowLeft, side });
  }, [align, placement]);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
  }, [formula, interpretation, method, open, text, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const reposition = () => updatePosition();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.blur();
      }
    };
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, updatePosition]);

  const tooltipStyle = {
    top: position?.top ?? -9999,
    left: position?.left ?? -9999,
    visibility: position ? "visible" : "hidden",
    opacity: position ? 1 : 0,
    "--tooltip-arrow-left": `${position?.arrowLeft ?? 18}px`,
  } as CSSProperties;

  const tooltip = open && typeof document !== "undefined"
    ? createPortal(
      <span
        className={`info-tooltip info-tooltip-portal is-${position?.side ?? placement}`}
        id={id}
        ref={tooltipRef}
        role="tooltip"
        style={tooltipStyle}
      >
        {text ? <span className="info-tooltip-summary">{text}</span> : null}
        {formula ? <span className="info-tooltip-row"><b>Formula</b><span>{formula}</span></span> : null}
        {method ? <span className="info-tooltip-row"><b>Method</b><span>{method}</span></span> : null}
        {interpretation ? <span className="info-tooltip-row"><b>Meaning</b><span>{interpretation}</span></span> : null}
      </span>,
      document.body,
    )
    : null;

  return (
    <>
      <button
        type="button"
        className="info-tip"
        ref={triggerRef}
        aria-label={label}
        aria-describedby={open ? id : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen(true)}
      >
        <MdInfoOutline aria-hidden="true" />
      </button>
      {tooltip}
    </>
  );
}
