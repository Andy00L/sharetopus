"use client";

import Image from "next/image";
import Script from "next/script";
import { useRef, useState } from "react";

import "./films.css";
import "./films-theme.css";

type FilmKey = "mcp-two-calls";

type ConceptFilmsEngine = {
  mount: (
    key: FilmKey,
    container: HTMLElement,
    options: { title?: boolean; caption?: boolean },
  ) => object | null;
};

declare global {
  interface Window {
    ConceptFilms?: ConceptFilmsEngine;
  }
}

// The engine renders every film at FRAME in public/films/films.js.
const POSTER_WIDTH_PX = 800;
const POSTER_HEIGHT_PX = 450;

type ConceptFilmProps = {
  filmKey: FilmKey;
  posterAlt: string;
  showCaption?: boolean;
};

export function ConceptFilm({ filmKey, posterAlt, showCaption = true }: ConceptFilmProps) {
  const filmContainerRef = useRef<HTMLDivElement>(null);
  const [isEngineReady, setIsEngineReady] = useState(false);
  const [isFilmMounted, setIsFilmMounted] = useState(false);

  const mountFilm = () => {
    const container = filmContainerRef.current;
    const engine = window.ConceptFilms;
    // next/script fires onReady on every mount, not only after the first load
    // (node_modules/next/dist/docs/01-app/02-guides/scripts.md): a filled container holds the player.
    if (!container || !engine || container.childElementCount > 0) return;
    if (engine.mount(filmKey, container, { caption: showCaption }) !== null) {
      setIsFilmMounted(true);
    }
  };

  return (
    <div>
      <Script src="/films/films.js" strategy="afterInteractive" onReady={() => setIsEngineReady(true)} />
      {isEngineReady && (
        <Script
          src={`/films/${filmKey}.js`}
          strategy="afterInteractive"
          onReady={mountFilm}
          onError={() => console.warn(`[ConceptFilm] ${filmKey}.js failed to load; the poster stays`)}
        />
      )}
      {!isFilmMounted && (
        <Image
          src={`/films/${filmKey}.png`}
          alt={posterAlt}
          width={POSTER_WIDTH_PX}
          height={POSTER_HEIGHT_PX}
          className="h-auto w-full rounded-[10px]"
        />
      )}
      <div ref={filmContainerRef} />
    </div>
  );
}
