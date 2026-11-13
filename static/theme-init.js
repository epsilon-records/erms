// Applies the theme a person chose (System, Light or Dark) before first paint, so pages don't
// flash. Loaded from <head> in app.html; ThemeSwitch.svelte writes the same key. labelkit 0038.
try {
	var t = localStorage.getItem('theme');
	if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch (_e) {
	// Storage blocked: follow the system setting.
}
