"use client";

import { useEffect, useRef } from "react";

export function EyeTracker({
  cardId,
  ctaId,
}: {
  cardId: string;
  ctaId: string;
}) {
  const eyeRefs = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)];
  const pupilRefs = [
    useRef<HTMLDivElement>(null),
    useRef<HTMLDivElement>(null),
  ];
  const dilateRefs = [
    useRef<HTMLDivElement>(null),
    useRef<HTMLDivElement>(null),
  ];
  const lidRefs = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)];

  useEffect(() => {
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduce) return;
    const isCoarse = window.matchMedia("(pointer: coarse)").matches;

    const eyes = eyeRefs
      .map((r) => r.current)
      .filter(Boolean) as HTMLDivElement[];
    const pupils = pupilRefs
      .map((r) => r.current)
      .filter(Boolean) as HTMLDivElement[];
    const dilates = dilateRefs
      .map((r) => r.current)
      .filter(Boolean) as HTMLDivElement[];
    const lids = lidRefs
      .map((r) => r.current)
      .filter(Boolean) as HTMLDivElement[];
    const card = document.getElementById(cardId);
    const cta = document.getElementById(ctaId);
    if (!card || !cta || eyes.length !== 2) return;

    const rects = {
      eyes: [
        { cx: 0, cy: 0, w: 0 },
        { cx: 0, cy: 0, w: 0 },
      ],
      cta: { left: 0, top: 0, right: 0, bottom: 0, cx: 0, cy: 0 },
      card: { left: 0, top: 0, width: 0, height: 0 },
    };

    const updateRects = () => {
      for (let i = 0; i < 2; i++) {
        const r = eyes[i].getBoundingClientRect();
        rects.eyes[i] = {
          cx: r.left + r.width / 2,
          cy: r.top + r.height / 2,
          w: r.width,
        };
      }
      const c = cta.getBoundingClientRect();
      rects.cta = {
        left: c.left,
        top: c.top,
        right: c.right,
        bottom: c.bottom,
        cx: c.left + c.width / 2,
        cy: c.top + c.height / 2,
      };
      const k = card.getBoundingClientRect();
      rects.card = {
        left: k.left,
        top: k.top,
        width: k.width,
        height: k.height,
      };
    };
    updateRects();

    let dilation = 1;
    const state = eyes.map(() => ({ tx: 0, ty: 0, cx: 0, cy: 0 }));
    const mouse: { x: number | null; y: number | null; lastMove: number } = {
      x: null,
      y: null,
      lastMove: 0,
    };
    let idleTarget: { x: number; y: number } | null = null;
    let lastIdlePick = 0;
    let ctaHover = false;
    const saccade = { x: 0, y: 0, until: 0 };
    let nextSaccadeAt = performance.now() + 1800 + Math.random() * 2200;
    let rafId = 0;
    let running = false;
    const blinkTimers: ReturnType<typeof setTimeout>[] = [];

    const onCtaEnter = () => (ctaHover = true);
    const onCtaLeave = () => (ctaHover = false);
    cta.addEventListener("pointerenter", onCtaEnter);
    cta.addEventListener("pointerleave", onCtaLeave);

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      mouse.lastMove = performance.now();
      idleTarget = null;
    };
    if (!isCoarse)
      window.addEventListener("pointermove", onPointerMove, { passive: true });

    const onScrollResize = () => updateRects();
    window.addEventListener("scroll", onScrollResize, { passive: true });
    window.addEventListener("resize", onScrollResize, { passive: true });

    const pickIdleTarget = () => {
      const r = rects.card;
      const padX = r.width * 0.15;
      const padY = r.height * 0.15;
      return {
        x: r.left + padX + Math.random() * (r.width - padX * 2),
        y: r.top + padY + Math.random() * (r.height - padY * 2),
      };
    };

    const tick = (now: number) => {
      if (!running) {
        rafId = 0;
        return;
      }

      let target: { x: number; y: number };
      if (ctaHover) {
        target = { x: rects.cta.cx, y: rects.cta.cy };
      } else if (
        !isCoarse &&
        mouse.x !== null &&
        mouse.y !== null &&
        now - mouse.lastMove < 2400
      ) {
        target = { x: mouse.x, y: mouse.y };
      } else {
        if (!idleTarget || now - lastIdlePick > 2000) {
          idleTarget = pickIdleTarget();
          lastIdlePick = now;
        }
        target = idleTarget;
      }

      if (now >= nextSaccadeAt) {
        saccade.x = (Math.random() * 2 - 1) * 1.6;
        saccade.y = (Math.random() * 2 - 1) * 1.2;
        saccade.until = now + 90;
        nextSaccadeAt = now + 2200 + Math.random() * 3000;
      }
      if (now > saccade.until) {
        saccade.x = 0;
        saccade.y = 0;
      }

      let targetDilation = 1;
      if (
        !isCoarse &&
        mouse.x !== null &&
        mouse.y !== null &&
        now - mouse.lastMove < 2400
      ) {
        const br = rects.cta;
        const cdx = Math.max(br.left - mouse.x, 0, mouse.x - br.right);
        const cdy = Math.max(br.top - mouse.y, 0, mouse.y - br.bottom);
        const cd = Math.hypot(cdx, cdy);
        const t = 1 - Math.min(1, cd / 260);
        targetDilation = 1 + t * t * (3 - 2 * t) * 0.35;
      }
      dilation += (targetDilation - dilation) * 0.14;

      for (let i = 0; i < eyes.length; i++) {
        const c = rects.eyes[i];
        const dx = target.x - c.cx;
        const dy = target.y - c.cy;
        const reach = Math.min(1, Math.hypot(dx, dy) / 280);
        const maxOff = c.w * 0.22;
        const ang = Math.atan2(dy, dx);
        state[i].tx = Math.cos(ang) * maxOff * reach;
        state[i].ty = Math.sin(ang) * maxOff * reach;
        state[i].cx += (state[i].tx - state[i].cx) * 0.18;
        state[i].cy += (state[i].ty - state[i].cy) * 0.18;

        const fx = state[i].cx + saccade.x;
        const fy = state[i].cy + saccade.y;
        pupils[i].style.transform =
          `translate3d(${fx.toFixed(2)}px, ${fy.toFixed(2)}px, 0)`;
        dilates[i].style.transform = `scale(${dilation.toFixed(3)})`;
      }

      rafId = requestAnimationFrame(tick);
    };

    const start = () => {
      if (running) return;
      running = true;
      updateRects();
      if (!rafId) rafId = requestAnimationFrame(tick);
    };
    const stop = () => {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
    };

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) start();
        else stop();
      },
      { threshold: 0 },
    );
    io.observe(card);

    const onVisibility = () => {
      if (document.hidden) stop();
      else {
        const r = card.getBoundingClientRect();
        if (r.top < window.innerHeight && r.bottom > 0) start();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    const blinkOnce = (i: number) => {
      const lid = lids[i];
      if (!lid) return;
      lid.classList.remove("blink");
      void lid.offsetWidth;
      lid.classList.add("blink");
    };

    const scheduleBlink = () => {
      const wait = 3000 + Math.random() * 3200;
      const id = setTimeout(() => {
        if (running) {
          const wink = Math.random() < 1 / 12;
          const dbl = !wink && Math.random() < 0.25;
          if (wink) blinkOnce(Math.random() < 0.5 ? 0 : 1);
          else {
            blinkOnce(0);
            blinkOnce(1);
            if (dbl) {
              const id2 = setTimeout(() => {
                blinkOnce(0);
                blinkOnce(1);
              }, 220);
              blinkTimers.push(id2);
            }
          }
        }
        scheduleBlink();
      }, wait);
      blinkTimers.push(id);
    };
    scheduleBlink();

    return () => {
      stop();
      io.disconnect();
      window.removeEventListener("scroll", onScrollResize);
      window.removeEventListener("resize", onScrollResize);
      if (!isCoarse) window.removeEventListener("pointermove", onPointerMove);
      cta.removeEventListener("pointerenter", onCtaEnter);
      cta.removeEventListener("pointerleave", onCtaLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      blinkTimers.forEach(clearTimeout);
    };
  }, [cardId, ctaId]);

  return (
    <div className="subprompt-eyes" aria-hidden="true">
      {[0, 1].map((i) => (
        <div key={i} className="subprompt-eye" ref={eyeRefs[i]}>
          <div className="subprompt-pupil" ref={pupilRefs[i]}>
            <div className="subprompt-pupil-inner" ref={dilateRefs[i]} />
          </div>
          <div className="subprompt-lid" ref={lidRefs[i]} />
        </div>
      ))}
    </div>
  );
}
