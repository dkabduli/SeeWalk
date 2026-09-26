import type { Lang } from "../api/types";

export const strings: Record<Lang, Record<string, string>> = {
  en: { start: "Start walk", stop: "Stop walk", ahead: "What's ahead?", lang: "Français",
        walking: "Walking", idle: "Tap Start walk", noConn: "No connection", blocked: "Camera blocked" },
  fr: { start: "Commencer", stop: "Arrêter", ahead: "Qu'y a-t-il devant ?", lang: "English",
        walking: "En marche", idle: "Touchez Commencer", noConn: "Pas de connexion", blocked: "Caméra bloquée" },
};
