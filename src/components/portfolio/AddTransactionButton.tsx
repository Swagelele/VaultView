import { AddTransactionDialog } from "@/components/portfolio/AddTransactionDialog";

export function AddTransactionButton() {
  function handleCreated() {
    globalThis.location.reload();
  }

  return <AddTransactionDialog onTransactionCreated={handleCreated} />;
}
