import React from "react";

export default function NoData() {
  return (
    <div className="p-6 bg-red-50 rounded-lg shadow-sm">
      <h2 className="text-lg font-semibold text-red-700">
        Error Loading Content
      </h2>
      <p className="text-red-600">{"Failed to load content history"}</p>
    </div>
  );
}
