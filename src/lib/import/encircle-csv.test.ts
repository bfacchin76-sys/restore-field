/**
 * Encircle CSV parser unit tests. PRD §10 DoD requires that the
 * importer can populate ≥100 historical jobs; this fixture is small
 * but exercises the same code paths the bulk import will hit.
 */
import { describe, expect, it } from "vitest";
import {
  encircleCsvHeader,
  encircleCsvSampleHeader,
  parseEncircleCsv,
} from "./encircle-csv";

const header = encircleCsvSampleHeader();

describe("parseEncircleCsv", () => {
  it("parses a happy-path row", () => {
    const csv = [
      header,
      [
        "Maria",
        "Lopez",
        "maria@example.com",
        "516-555-0144",
        "12 Maple Ave",
        "",
        "Garden City",
        "NY",
        "11530",
        "Allstate",
        "POL-9912",
        "CLM-4421",
        "Pat Adjuster",
        "pat@allstate.example",
        "212-555-0010",
        "Water",
        "2026-05-01",
        "Burst supply line",
        "Demo wet drywall",
        "encircle-id-1",
      ].join(","),
    ].join("\n");

    const r = parseEncircleCsv(csv);
    expect(r.errors).toHaveLength(0);
    expect(r.rows).toHaveLength(1);
    const row = r.rows[0]!;
    expect(row.customerFirstName).toBe("Maria");
    expect(row.lossType).toBe("WATER");
    expect(row.lossDate?.toISOString().slice(0, 10)).toBe("2026-05-01");
    expect(row.customerEmail).toBe("maria@example.com");
    expect(row.state).toBe("NY");
  });

  it("parses US m/d/yyyy dates and synonym loss types", () => {
    const csv = [
      header,
      [
        "Joe",
        "Smith",
        "",
        "",
        "1 Oak St",
        "",
        "Hempstead",
        "ny",
        "11550",
        "",
        "",
        "",
        "",
        "",
        "",
        "Fire damage",
        "5/1/2026",
        "",
        "",
        "",
      ].join(","),
    ].join("\n");

    const r = parseEncircleCsv(csv);
    expect(r.errors).toHaveLength(0);
    expect(r.rows[0]!.lossType).toBe("FIRE");
    expect(r.rows[0]!.lossDate?.toISOString().slice(0, 10)).toBe("2026-05-01");
    expect(r.rows[0]!.state).toBe("NY");
  });

  it("flags missing required fields without aborting the rest", () => {
    const csv = [
      header,
      // missing lastName
      "Alice,,,,,,,,,,,,,,,Water,,,,",
      // valid
      [
        "Bob",
        "Jones",
        "",
        "",
        "5 Pine Dr",
        "",
        "Garden City",
        "NY",
        "11530",
        "",
        "",
        "",
        "",
        "",
        "",
        "Mold",
        "",
        "",
        "",
        "",
      ].join(","),
    ].join("\n");

    const r = parseEncircleCsv(csv);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.line).toBe(2);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.lossType).toBe("MOLD");
  });

  it("rejects header missing a required column", () => {
    const r = parseEncircleCsv("customerFirstName,customerLastName\nA,B");
    expect(r.rows).toHaveLength(0);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors[0]!.message).toMatch(/Missing required column/);
  });

  it("scales: parses 100 rows", () => {
    const rows: string[] = [header];
    for (let i = 0; i < 100; i++) {
      rows.push(
        [
          `First${i}`,
          `Last${i}`,
          "",
          "",
          `${i} Test Rd`,
          "",
          "Garden City",
          "NY",
          "11530",
          "Allstate",
          "",
          "",
          "",
          "",
          "",
          "Water",
          "2026-05-01",
          "",
          "",
          "",
        ].join(","),
      );
    }
    const r = parseEncircleCsv(rows.join("\n"));
    expect(r.errors).toHaveLength(0);
    expect(r.rows).toHaveLength(100);
  });

  it("exports a stable header", () => {
    expect(encircleCsvHeader[0]).toBe("customerFirstName");
    expect(header.split(",")).toHaveLength(encircleCsvHeader.length);
  });
});
