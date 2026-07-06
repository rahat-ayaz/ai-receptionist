import Image from "next/image";
import caproLogo from "@/images/capro-white.svg";

export function Logo({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const heightClass = size === "lg" ? "h-[60px]" : size === "sm" ? "h-[36px]" : "h-[48px]";
  return (
    <div className="flex items-center">
      <Image
        src={caproLogo}
        alt="CAPRO Logo"
        className={`${heightClass} w-auto object-contain`}
        priority
      />
    </div>
  );
}

