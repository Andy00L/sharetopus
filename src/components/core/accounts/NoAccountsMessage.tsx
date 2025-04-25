import { Users } from "lucide-react";
import React from "react";

export default function NoAccountsMessage() {
  return (
    <div className="text-center p-8 border rounded-lg bg-muted/30">
      <Users className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
      <h3 className="text-lg font-medium mb-2">Aucun compte social connecté</h3>
      <p className="text-muted-foreground mb-4">
        Connectez vos comptes sociaux pour les gérer ici.
      </p>
    </div>
  );
}
