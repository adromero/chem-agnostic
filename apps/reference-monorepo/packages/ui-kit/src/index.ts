// Minimal shared design-system component types. The real package would
// export Button/Card/Modal React components; we keep the surface small here.

export type ButtonVariant = "primary" | "secondary" | "danger";

export interface ButtonProps {
  variant?: ButtonVariant;
  disabled?: boolean;
  onClick?: () => void;
  children?: unknown;
}

export interface CardProps {
  title: string;
  children?: unknown;
}

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  children?: unknown;
}
