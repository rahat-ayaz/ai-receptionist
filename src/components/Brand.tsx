import Image from "next/image";
import caproLogo from "@/images/capro-color.svg";

export function Logo({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const heightClass = size === "lg" ? "h-[40px]" : size === "sm" ? "h-[24px]" : "h-[32px]";
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

