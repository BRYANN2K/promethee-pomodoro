const handle = requireButton("runtimeHandle");
const runtime = window.prometheePomodoroRuntime;
const language = (navigator.languages[0] ?? navigator.language).toLowerCase().startsWith("fr") ? "fr" : "en";
const labels = language === "fr"
  ? { close: "Fermer le menu Pomodoro", open: "Ouvrir le menu Pomodoro" }
  : { close: "Close Pomodoro menu", open: "Open Pomodoro menu" };

document.documentElement.lang = language;
handle.setAttribute("aria-label", labels.open);
handle.addEventListener("click", () => runtime?.toggleMenu());
runtime?.onMenuState((open) => {
  handle.setAttribute("aria-expanded", String(open));
  handle.setAttribute("aria-label", open ? labels.close : labels.open);
});

function requireButton(id: string): HTMLButtonElement {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLButtonElement)) {
    throw new Error(`Missing button: ${id}`);
  }
  return element;
}
