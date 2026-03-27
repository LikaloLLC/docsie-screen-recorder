import { useEffect, useState } from "react";

export interface CameraDevice {
	deviceId: string;
	label: string;
	groupId: string;
}

export function useCameraDevices(enabled: boolean = false) {
	const [devices, setDevices] = useState<CameraDevice[]>([]);
	const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let mounted = true;

		const loadDevices = async () => {
			try {
				setIsLoading(true);
				setError(null);

				// Re-request permission if labels are missing
				const allDevicesBefore = await navigator.mediaDevices.enumerateDevices();
				const needsPermission = allDevicesBefore.some((d) => d.kind === "videoinput" && !d.label);

				if (needsPermission && enabled) {
					try {
						const stream = await navigator.mediaDevices.getUserMedia({ video: true });
						stream.getTracks().forEach((track) => track.stop());
					} catch (e) {
						console.warn("Failed to get camera permission for labels:", e);
					}
				}

				const allDevices = await navigator.mediaDevices.enumerateDevices();
				const videoInputs = allDevices
					.filter((device) => device.kind === "videoinput")
					.map((device) => ({
						deviceId: device.deviceId,
						label: device.label || `Camera ${device.deviceId.slice(0, 8)}`,
						groupId: device.groupId,
					}));

				if (mounted) {
					setDevices(videoInputs);
					if (!selectedDeviceId && videoInputs.length > 0) {
						setSelectedDeviceId(videoInputs[0].deviceId);
					}
					setIsLoading(false);
				}
			} catch (err) {
				if (mounted) {
					setError(err instanceof Error ? err.message : "Failed to load cameras");
					setIsLoading(false);
				}
			}
		};

		loadDevices();

		navigator.mediaDevices.addEventListener("devicechange", loadDevices);
		return () => {
			mounted = false;
			navigator.mediaDevices.removeEventListener("devicechange", loadDevices);
		};
	}, [enabled, selectedDeviceId]);

	return { devices, selectedDeviceId, setSelectedDeviceId, isLoading, error };
}
