import React from "react";
import { Check } from "lucide-react";

interface StepProgressProps {
  readonly steps: string[];
  readonly currentStep: number;
}

export function StepProgress({ steps, currentStep }: StepProgressProps) {
  // Pre-process all step data first
  const stepData = steps.map((label, index) => {
    const stepNumber = index + 1;
    const isCompleted = stepNumber < currentStep;
    const isActive = stepNumber === currentStep;

    let className =
      "w-8 h-8 rounded-full flex items-center justify-center border-2";
    if (isCompleted) {
      className += " bg-green-500 border-green-500 text-white";
    } else if (isActive) {
      className += " bg-primary border-primary text-white";
    } else {
      className += " bg-muted border-muted-foreground/30 text-muted-foreground";
    }

    const content = isCompleted ? <Check className="h-4 w-4" /> : stepNumber;

    return { label, className, content, key: label };
  });

  // Calculate progress percentage
  const progressPercentage = ((currentStep - 1) / (steps.length - 1)) * 100;

  return (
    <div className="mb-8">
      <div className="flex justify-between mb-2">
        {stepData.map((step) => (
          <div key={step.key} className="flex items-center flex-col">
            <div className={step.className}>{step.content}</div>
            <div className="text-sm text-muted-foreground text-center mt-1">
              {step.label}
            </div>
          </div>
        ))}
      </div>
      <div className="w-full bg-muted h-2 rounded-full overflow-hidden">
        <div
          className="bg-primary h-full"
          style={{ width: `${progressPercentage}%` }}
        />
      </div>
    </div>
  );
}
