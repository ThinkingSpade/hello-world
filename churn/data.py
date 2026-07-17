"""Load and clean the IBM Telco Customer Churn dataset.

Known quirks of the raw file, handled here:
- TotalCharges has 11 blank strings (brand-new customers) → treated as 0.
- SeniorCitizen is already 0/1 while every other flag is Yes/No.
- customerID carries no signal and is dropped.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

DATA_FILE = Path(__file__).resolve().parents[1] / "data" / "telco-customer-churn.csv"

TARGET = "Churn"

# TotalCharges is ~ tenure × MonthlyCharges (r > 0.99 on this data); we drop
# it so the browser model doesn't carry a redundant, collinear input.
DROP = ["customerID", "TotalCharges"]

NUMERIC = ["tenure", "MonthlyCharges"]

CATEGORICAL = [
    "gender", "SeniorCitizen", "Partner", "Dependents", "PhoneService",
    "MultipleLines", "InternetService", "OnlineSecurity", "OnlineBackup",
    "DeviceProtection", "TechSupport", "StreamingTV", "StreamingMovies",
    "Contract", "PaperlessBilling", "PaymentMethod",
]


def load(path: str | Path = DATA_FILE) -> pd.DataFrame:
    df = pd.read_csv(path)
    df["TotalCharges"] = pd.to_numeric(df["TotalCharges"], errors="coerce").fillna(0.0)
    df["SeniorCitizen"] = df["SeniorCitizen"].map({0: "No", 1: "Yes"})
    df = df.drop(columns=[c for c in DROP if c in df.columns])
    df[TARGET] = (df[TARGET] == "Yes").astype(int)
    return df
