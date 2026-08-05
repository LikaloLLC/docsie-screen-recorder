import { useEffect, useRef, useState } from "react";

const STEPS = [
	"Step 1 — Confirm lockout/tagout on panel B",
	"Step 2 — Remove housing cover (4x M6 bolts)",
	"Step 3 — Disconnect coolant line at valve A4",
	"Step 4 — Extract spindle assembly straight up",
	"Step 5 — Inspect bearing seat for scoring",
	"Step 6 — Seat replacement assembly and torque to 24 Nm",
];

const STEP_INTERVAL_MS = 6000;

/**
 * Demo-only stand-in for an external headset/viewer application. Renders a
 * fake mixed-reality feed (wireframe machine part + HUD chrome) inside a
 * window titled "Viewer" so the Capture Companion's window match rule has
 * something to attach to during demos.
 */
export function ViewerSimulator() {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const [stepIndex, setStepIndex] = useState(0);
	const [clock, setClock] = useState(() => new Date().toLocaleTimeString());

	useEffect(() => {
		document.title = "Viewer (Simulator)";
	}, []);

	useEffect(() => {
		const stepTimer = window.setInterval(() => {
			setStepIndex((index) => (index + 1) % STEPS.length);
		}, STEP_INTERVAL_MS);
		const clockTimer = window.setInterval(() => {
			setClock(new Date().toLocaleTimeString());
		}, 1000);
		return () => {
			window.clearInterval(stepTimer);
			window.clearInterval(clockTimer);
		};
	}, []);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		let rafId = 0;
		let running = true;

		const vertices: Array<[number, number, number]> = [];
		// Simple machine-ish shape: a box with a ring of points underneath.
		for (const x of [-1, 1]) {
			for (const y of [-0.6, 0.6]) {
				for (const z of [-0.7, 0.7]) {
					vertices.push([x, y, z]);
				}
			}
		}
		const ringSegments = 14;
		for (let index = 0; index < ringSegments; index += 1) {
			const angle = (index / ringSegments) * Math.PI * 2;
			vertices.push([Math.cos(angle) * 0.45, -1.05, Math.sin(angle) * 0.45]);
		}

		const boxEdges: Array<[number, number]> = [
			[0, 1],
			[0, 2],
			[0, 4],
			[1, 3],
			[1, 5],
			[2, 3],
			[2, 6],
			[3, 7],
			[4, 5],
			[4, 6],
			[5, 7],
			[6, 7],
		];

		const render = (timeMs: number) => {
			if (!running) return;
			const width = canvas.clientWidth;
			const height = canvas.clientHeight;
			if (canvas.width !== width || canvas.height !== height) {
				canvas.width = width;
				canvas.height = height;
			}

			ctx.fillStyle = "#05070c";
			ctx.fillRect(0, 0, width, height);

			// Faint grid floor
			ctx.strokeStyle = "rgba(70, 110, 180, 0.14)";
			ctx.lineWidth = 1;
			for (let index = 0; index <= 12; index += 1) {
				const gx = (index / 12) * width;
				ctx.beginPath();
				ctx.moveTo(gx, height * 0.55);
				ctx.lineTo(width / 2 + (gx - width / 2) * 2.2, height);
				ctx.stroke();
			}
			for (let index = 0; index <= 6; index += 1) {
				const gy = height * 0.55 + (index / 6) * height * 0.45;
				ctx.beginPath();
				ctx.moveTo(0, gy);
				ctx.lineTo(width, gy);
				ctx.stroke();
			}

			const angle = timeMs * 0.0004;
			const cosA = Math.cos(angle);
			const sinA = Math.sin(angle);
			const tilt = 0.35;
			const cosT = Math.cos(tilt);
			const sinT = Math.sin(tilt);
			const scale = Math.min(width, height) * 0.22;
			const centerX = width / 2;
			const centerY = height * 0.44;

			const projected = vertices.map(([x, y, z]) => {
				const rx = x * cosA - z * sinA;
				const rz = x * sinA + z * cosA;
				const ry = y * cosT - rz * sinT;
				const rz2 = y * sinT + rz * cosT;
				const depth = 1 / (1 + rz2 * 0.18);
				return [centerX + rx * scale * depth, centerY + ry * scale * depth] as const;
			});

			ctx.strokeStyle = "rgba(120, 200, 255, 0.85)";
			ctx.lineWidth = 1.5;
			for (const [from, to] of boxEdges) {
				ctx.beginPath();
				ctx.moveTo(projected[from][0], projected[from][1]);
				ctx.lineTo(projected[to][0], projected[to][1]);
				ctx.stroke();
			}

			ctx.strokeStyle = "rgba(255, 176, 90, 0.9)";
			ctx.beginPath();
			for (let index = 0; index < ringSegments; index += 1) {
				const point = projected[8 + index];
				const next = projected[8 + ((index + 1) % ringSegments)];
				ctx.moveTo(point[0], point[1]);
				ctx.lineTo(next[0], next[1]);
			}
			ctx.stroke();

			// Target reticle cycling around the highlighted ring
			const reticle = projected[8 + (Math.floor(timeMs / 900) % ringSegments)];
			ctx.strokeStyle = "rgba(120, 255, 170, 0.9)";
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.arc(reticle[0], reticle[1], 14, 0, Math.PI * 2);
			ctx.stroke();
			ctx.beginPath();
			ctx.moveTo(reticle[0] - 22, reticle[1]);
			ctx.lineTo(reticle[0] - 8, reticle[1]);
			ctx.moveTo(reticle[0] + 8, reticle[1]);
			ctx.lineTo(reticle[0] + 22, reticle[1]);
			ctx.stroke();

			rafId = window.requestAnimationFrame(render);
		};

		rafId = window.requestAnimationFrame(render);
		return () => {
			running = false;
			window.cancelAnimationFrame(rafId);
		};
	}, []);

	return (
		<div className="relative w-screen h-screen bg-[#05070c] text-white overflow-hidden font-mono select-none">
			<canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

			<div className="absolute top-4 left-5 text-[13px] tracking-[0.25em] text-sky-300/90">
				HEADSET&nbsp;VIEWER
				<span className="ml-3 text-[10px] tracking-[0.15em] text-sky-300/50">SIMULATED FEED</span>
			</div>
			<div className="absolute top-4 right-5 text-[11px] text-sky-200/70 text-right leading-5">
				<div>{clock}</div>
				<div>TRACKING: LOCKED</div>
				<div>FPS 59.9 · LAT 11ms</div>
			</div>

			<div className="absolute bottom-16 left-1/2 -translate-x-1/2 px-5 py-2.5 rounded border border-emerald-300/40 bg-emerald-900/30 text-emerald-100 text-sm">
				{STEPS[stepIndex]}
			</div>

			<div className="absolute bottom-4 left-5 text-[10px] text-sky-200/50 leading-4">
				<div>SESSION: MAINT-TRAIN-07</div>
				<div>MODEL: SPINDLE-ASSY rev C</div>
			</div>
			<div className="absolute bottom-4 right-5 text-[10px] text-amber-200/60">
				&#9679; HMD CONNECTED
			</div>
		</div>
	);
}
