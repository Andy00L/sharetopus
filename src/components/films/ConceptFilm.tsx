"use client";

import Image from "next/image";
import Script from "next/script";
import { useRef, useState } from "react";

import "./films.css";
import "./films-theme.css";

/** Films with a script and a poster under public/films. */
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

// Poster size in px, sourceRef: public/films/films.js FRAME.
const POSTER_WIDTH = 800;
const POSTER_HEIGHT = 450;

type ConceptFilmProps = {
  filmKey: FilmKey;
  posterAlt: string;
  showCaption?: boolean;
};

/** A concept film from public/films; its poster shows until the engine mounts the live player. */
export function ConceptFilm({ filmKey, posterAlt, showCaption = true }: ConceptFilmProps) {
  const filmContainerRef = useRef<HTMLDivElement>(null);
  const [isEngineReady, setIsEngineReady] = useState(false);
  const [isFilmMounted, setIsFilmMounted] = useState(false);

  const mountFilm = () => {
    const container = filmContainerRef.current;
    const engine = window.ConceptFilms;
    // onReady also fires on remount; a filled container already holds the player.
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
          width={POSTER_WIDTH}
          height={POSTER_HEIGHT}
          className="h-auto w-full rounded-[10px]"
        />
      )}
      <div ref={filmContainerRef} />
    </div>
  );
}
