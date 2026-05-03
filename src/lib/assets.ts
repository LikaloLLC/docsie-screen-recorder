export function getBundledAssetUrl(filename: string) {
	return new URL(filename, window.location.href).toString();
}
