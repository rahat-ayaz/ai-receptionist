import Image from "next/image";
import logoWhite from "@/images/ai-receptionist-white.svg";

export function Logo({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const heightClass = size === "lg" ? "h-[60px]" : size === "sm" ? "h-[36px]" : "h-[48px]";
  return (
    <div className="flex items-center">
      <Image
        src={logoWhite}
        alt="AI Receptionist logo"
        className={`${heightClass} w-auto object-contain`}
        priority
      />
    </div>
  );
}

