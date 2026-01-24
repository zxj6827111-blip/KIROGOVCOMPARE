import React from 'react';
import { CityYearSelector } from './CityYearSelector';

interface StepperHeaderProps {
  steps: string[];
  currentStep: number;
  onStepChange: (step: number) => void;
  onPrev: () => void;
  onNext: () => void;
  cityName: string;
  year: number;
  years: number[];
  onYearChange: (year: number) => void;
  onOpenCitySelector?: () => void;
}

export const StepperHeader: React.FC<StepperHeaderProps> = ({
  steps,
  currentStep,
  onStepChange,
  onPrev,
  onNext,
  cityName,
  year,
  years,
  onYearChange,
  onOpenCitySelector,
}) => {
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm px-6 py-4 flex flex-col gap-4">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          {steps.map((label, index) => {
            const isActive = index === currentStep;
            const isDone = index < currentStep;
            return (
              <button
                key={label}
                type="button"
                onClick={() => onStepChange(index)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors border ${
                  isActive
                    ? 'bg-slate-900 text-white border-slate-900'
                    : isDone
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'
                }`}
              >
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${
                  isActive
                    ? 'bg-white text-slate-900'
                    : isDone
                      ? 'bg-emerald-500 text-white'
                      : 'bg-slate-200 text-slate-600'
                }`}
                >
                  {index + 1}
                </span>
                {label}
              </button>
            );
          })}
        </div>
        <CityYearSelector
          cityName={cityName}
          year={year}
          years={years}
          onYearChange={onYearChange}
          onOpenCitySelector={onOpenCitySelector}
        />
      </div>
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onPrev}
          disabled={currentStep === 0}
          className="px-3 py-1.5 text-xs font-semibold rounded border border-slate-200 text-slate-600 disabled:opacity-40"
        >
          上一步
        </button>
        <div className="text-xs text-slate-500">{steps[currentStep]}</div>
        <button
          type="button"
          onClick={onNext}
          disabled={currentStep === steps.length - 1}
          className="px-3 py-1.5 text-xs font-semibold rounded border border-slate-200 text-slate-600 disabled:opacity-40"
        >
          下一步
        </button>
      </div>
    </div>
  );
};
