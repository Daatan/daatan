-- daatan#2166: the author's re-check of an edited claim, and a publish over a still-unclear
-- verdict, are each logged as a forecast-creation attempt row with this outcome.
ALTER TYPE "ForecastAttemptOutcome" ADD VALUE 'DEFINEDNESS_CHECK';
