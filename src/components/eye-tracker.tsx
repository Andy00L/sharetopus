"use client";

import { useCallback } from "react";

const MAX_PUPIL_DILATION_GAIN = 0.35;

function easeSmoothstep(progress: number): number {
  return progress * progress * (3 - 2 * progress);
}

function restartCssAnimation(element: HTMLElement, animationClassName: string) {
  element.classList.remove(animationClassName);
  void element.offsetWidth;
  element.classList.add(animationClassName);
}

function queryEyeParts(container: HTMLDivElement, selector: string): HTMLDivElement[] {
  return [...container.querySelectorAll<HTMLDivElement>(selector)];
}

export function EyeTracker({
  cardId,
  ctaId,
}: {
  cardId: string;
  ctaId: string;
}) {
  const animateEyesWhileMounted = useCallback((eyesContainer: HTMLDivElement | null) => {
    if (!eyesContainer) return;
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (prefersReducedMotion) return;
    const isCoarse = window.matchMedia("(pointer: coarse)").matches;

    const eyes = queryEyeParts(eyesContainer, ".subprompt-eye");
    const pupils = queryEyeParts(eyesContainer, ".subprompt-pupil");
    const dilates = queryEyeParts(eyesContainer, ".subprompt-pupil-inner");
    const lids = queryEyeParts(eyesContainer, ".subprompt-lid");
    const card = document.getElementById(cardId);
    const cta = document.getElementById(ctaId);
    if (!card || !cta || eyes.length !== 2) return;

    const rects = {
      eyes: [
        { centerX: 0, centerY: 0, width: 0 },
        { centerX: 0, centerY: 0, width: 0 },
      ],
      cta: { left: 0, top: 0, right: 0, bottom: 0, centerX: 0, centerY: 0 },
      card: { left: 0, top: 0, width: 0, height: 0 },
    };

    const updateRects = () => {
      eyes.forEach((eye, eyeIndex) => {
        const eyeRect = eye.getBoundingClientRect();
        rects.eyes[eyeIndex] = {
          centerX: eyeRect.left + eyeRect.width / 2,
          centerY: eyeRect.top + eyeRect.height / 2,
          width: eyeRect.width,
        };
      });
      const ctaRect = cta.getBoundingClientRect();
      rects.cta = {
        left: ctaRect.left,
        top: ctaRect.top,
        right: ctaRect.right,
        bottom: ctaRect.bottom,
        centerX: ctaRect.left + ctaRect.width / 2,
        centerY: ctaRect.top + ctaRect.height / 2,
      };
      const cardRect = card.getBoundingClientRect();
      rects.card = {
        left: cardRect.left,
        top: cardRect.top,
        width: cardRect.width,
        height: cardRect.height,
      };
    };
    updateRects();

    let dilation = 1;
    const pupilOffsets = eyes.map(() => ({ currentX: 0, currentY: 0 }));
    const mouse: { clientX: number | null; clientY: number | null; lastMove: number } = {
      clientX: null,
      clientY: null,
      lastMove: 0,
    };
    let idleTarget: { clientX: number; clientY: number } | null = null;
    let lastIdlePick = 0;
    let isHoveringCta = false;
    const saccade = { offsetX: 0, offsetY: 0, until: 0 };
    let nextSaccadeAt = performance.now() + 1800 + Math.random() * 2200;
    let rafId = 0;
    let isRunning = false;
    let nextBlinkTimer: ReturnType<typeof setTimeout> | undefined;
    let secondBlinkTimer: ReturnType<typeof setTimeout> | undefined;

    const onCtaEnter = () => (isHoveringCta = true);
    const onCtaLeave = () => (isHoveringCta = false);
    cta.addEventListener("pointerenter", onCtaEnter);
    cta.addEventListener("pointerleave", onCtaLeave);

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      mouse.clientX = event.clientX;
      mouse.clientY = event.clientY;
      mouse.lastMove = performance.now();
      idleTarget = null;
    };
    if (!isCoarse)
      window.addEventListener("pointermove", onPointerMove, { passive: true });

    const onScrollResize = () => {
      if (isRunning) updateRects();
    };
    window.addEventListener("scroll", onScrollResize, { passive: true });
    window.addEventListener("resize", onScrollResize, { passive: true });

    const pickIdleTarget = () => {
      const cardBounds = rects.card;
      const padX = cardBounds.width * 0.15;
      const padY = cardBounds.height * 0.15;
      return {
        clientX: cardBounds.left + padX + Math.random() * (cardBounds.width - padX * 2),
        clientY: cardBounds.top + padY + Math.random() * (cardBounds.height - padY * 2),
      };
    };

    const tick = (now: number) => {
      if (!isRunning) {
        rafId = 0;
        return;
      }

      let target: { clientX: number; clientY: number };
      if (isHoveringCta) {
        target = { clientX: rects.cta.centerX, clientY: rects.cta.centerY };
      } else if (
        !isCoarse &&
        mouse.clientX !== null &&
        mouse.clientY !== null &&
        now - mouse.lastMove < 2400
      ) {
        target = { clientX: mouse.clientX, clientY: mouse.clientY };
      } else {
        if (!idleTarget || now - lastIdlePick > 2000) {
          idleTarget = pickIdleTarget();
          lastIdlePick = now;
        }
        target = idleTarget;
      }

      if (now >= nextSaccadeAt) {
        saccade.offsetX = (Math.random() * 2 - 1) * 1.6;
        saccade.offsetY = (Math.random() * 2 - 1) * 1.2;
        saccade.until = now + 90;
        nextSaccadeAt = now + 2200 + Math.random() * 3000;
      }
      if (now > saccade.until) {
        saccade.offsetX = 0;
        saccade.offsetY = 0;
      }

      let targetDilation = 1;
      if (
        !isCoarse &&
        mouse.clientX !== null &&
        mouse.clientY !== null &&
        now - mouse.lastMove < 2400
      ) {
        const ctaBounds = rects.cta;
        const gapX = Math.max(ctaBounds.left - mouse.clientX, 0, mouse.clientX - ctaBounds.right);
        const gapY = Math.max(ctaBounds.top - mouse.clientY, 0, mouse.clientY - ctaBounds.bottom);
        const proximity = 1 - Math.min(1, Math.hypot(gapX, gapY) / 260);
        targetDilation = 1 + easeSmoothstep(proximity) * MAX_PUPIL_DILATION_GAIN;
      }
      dilation += (targetDilation - dilation) * 0.14;

      pupilOffsets.forEach((pupilOffset, eyeIndex) => {
        const eyeCenter = rects.eyes[eyeIndex];
        const deltaX = target.clientX - eyeCenter.centerX;
        const deltaY = target.clientY - eyeCenter.centerY;
        const reach = Math.min(1, Math.hypot(deltaX, deltaY) / 280);
        const maxOffset = eyeCenter.width * 0.22;
        const angle = Math.atan2(deltaY, deltaX);
        const targetX = Math.cos(angle) * maxOffset * reach;
        const targetY = Math.sin(angle) * maxOffset * reach;
        pupilOffset.currentX += (targetX - pupilOffset.currentX) * 0.18;
        pupilOffset.currentY += (targetY - pupilOffset.currentY) * 0.18;

        const pupilX = pupilOffset.currentX + saccade.offsetX;
        const pupilY = pupilOffset.currentY + saccade.offsetY;
        pupils[eyeIndex].style.transform =
          `translate3d(${pupilX.toFixed(2)}px, ${pupilY.toFixed(2)}px, 0)`;
        dilates[eyeIndex].style.transform = `scale(${dilation.toFixed(3)})`;
      });

      rafId = requestAnimationFrame(tick);
    };

    const start = () => {
      if (isRunning) return;
      isRunning = true;
      updateRects();
      if (!rafId) rafId = requestAnimationFrame(tick);
    };
    const stop = () => {
      isRunning = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
    };

    const visibilityObserver = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) start();
        else stop();
      },
      { threshold: 0 },
    );
    visibilityObserver.observe(card);

    const onVisibility = () => {
      if (document.hidden) stop();
      else {
        const cardRect = card.getBoundingClientRect();
        if (cardRect.top < window.innerHeight && cardRect.bottom > 0) start();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    const blinkOnce = (eyeIndex: number) => {
      const lid = lids[eyeIndex];
      if (!lid) return;
      restartCssAnimation(lid, "blink");
    };

    const scheduleBlink = () => {
      const wait = 3000 + Math.random() * 3200;
      nextBlinkTimer = setTimeout(() => {
        if (isRunning) {
          const isWink = Math.random() < 1 / 12;
          const isDoubleBlink = !isWink && Math.random() < 0.25;
          if (isWink) blinkOnce(Math.random() < 0.5 ? 0 : 1);
          else {
            blinkOnce(0);
            blinkOnce(1);
            if (isDoubleBlink) {
              secondBlinkTimer = setTimeout(() => {
                blinkOnce(0);
                blinkOnce(1);
              }, 220);
            }
          }
        }
        scheduleBlink();
      }, wait);
    };
    scheduleBlink();

    return () => {
      stop();
      visibilityObserver.disconnect();
      window.removeEventListener("scroll", onScrollResize);
      window.removeEventListener("resize", onScrollResize);
      if (!isCoarse) window.removeEventListener("pointermove", onPointerMove);
      cta.removeEventListener("pointerenter", onCtaEnter);
      cta.removeEventListener("pointerleave", onCtaLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      clearTimeout(nextBlinkTimer);
      clearTimeout(secondBlinkTimer);
    };
  }, [cardId, ctaId]);

  return (
    <div ref={animateEyesWhileMounted} className="subprompt-eyes" aria-hidden="true">
      {[0, 1].map((eyeIndex) => (
        <div key={eyeIndex} className="subprompt-eye">
          <div className="subprompt-pupil">
            <div className="subprompt-pupil-inner" />
          </div>
          <div className="subprompt-lid" />
        </div>
      ))}
    </div>
  );
}
