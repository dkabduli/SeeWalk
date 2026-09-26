import type { Lang } from "../api/types";

export const strings: Record<Lang, Record<string, string>> = {
  en: {
    start: "Start walk", stop: "Stop", ahead: "What's ahead?", lang: "Français",
    walking: "Walking", idle: "Ready", noConn: "No connection", blocked: "Camera blocked",
    tagline: "A white cane finds the ground. SeeWalk finds everything else.",
    step1: "Hang the phone on your chest, rear camera facing forward.",
    step2: "Put on open-ear or bone-conduction headphones.",
    step3: "Tap Start. Any time, say “SeeWalk, what's ahead?” or tap the lower half of the screen.",
    listening: "Listening for “SeeWalk, what's ahead?”",
    quiet: "Nothing to report",
  },
  fr: {
    start: "Commencer", stop: "Arrêter", ahead: "Qu'y a-t-il devant ?", lang: "English",
    walking: "En marche", idle: "Prêt", noConn: "Pas de connexion", blocked: "Caméra bloquée",
    tagline: "La canne blanche trouve le sol. SeeWalk trouve tout le reste.",
    step1: "Portez le téléphone sur la poitrine, caméra arrière vers l'avant.",
    step2: "Mettez des écouteurs ouverts ou à conduction osseuse.",
    step3: "Touchez Commencer. À tout moment, dites « SeeWalk, qu'y a-t-il devant ? » ou touchez le bas de l'écran.",
    listening: "À l'écoute de « SeeWalk, qu'y a-t-il devant ? »",
    quiet: "Rien à signaler",
  },
};
