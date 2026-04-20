import { cn } from "@/lib/utils";

interface SubrowProps {
	children: React.ReactNode;
}

export default function Subrow({ children }: SubrowProps) {
	return (
		<div
			className={cn(
				"flex items-center min-h-[32px] gap-1 px-2 py-0.5 bg-[#3a2923] rounded-md text-slate-300",
			)}
		>
			{children}
		</div>
	);
}
