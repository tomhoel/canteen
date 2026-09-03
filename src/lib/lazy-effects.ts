import type { Options as ConfettiOptions } from "canvas-confetti";

export async function fireConfetti(options: ConfettiOptions) {
  const confetti = (await import("canvas-confetti")).default;
  return confetti(options);
}

export async function showToast(
  type: "success" | "error" | "info" | "warning",
  message: string,
  options?: Record<string, unknown>
) {
  const { toast } = await import("sonner");
  return (toast as any)[type](message, options);
}
