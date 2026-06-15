import { useState } from "react";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { TransactionForm } from "@/components/portfolio/TransactionForm";

interface AddTransactionDialogProps {
  onTransactionCreated: () => void;
}

export function AddTransactionDialog({ onTransactionCreated }: AddTransactionDialogProps) {
  const [open, setOpen] = useState(false);

  function handleSuccess() {
    setOpen(false);
    onTransactionCreated();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <PlusIcon className="mr-2 size-4" />
          Add Transaction
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Transaction</DialogTitle>
        </DialogHeader>
        <TransactionForm onSuccess={handleSuccess} />
      </DialogContent>
    </Dialog>
  );
}
