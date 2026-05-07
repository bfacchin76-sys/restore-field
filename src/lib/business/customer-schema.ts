import { z } from "zod";

export const customerSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required"),
  lastName: z.string().trim().min(1, "Last name is required"),
  email: z.string().trim().toLowerCase().email().optional().or(z.literal("")),
  phone: z.string().trim().optional().or(z.literal("")),
  addressLine1: z.string().trim().min(1, "Address is required"),
  addressLine2: z.string().trim().optional().or(z.literal("")),
  city: z.string().trim().min(1, "City is required"),
  state: z.string().trim().min(2).max(2).default("NY"),
  postalCode: z.string().trim().min(3, "Postal code is required"),
  insuranceCarrier: z.string().trim().optional().or(z.literal("")),
  policyNumber: z.string().trim().optional().or(z.literal("")),
  claimNumber: z.string().trim().optional().or(z.literal("")),
  adjusterName: z.string().trim().optional().or(z.literal("")),
  adjusterEmail: z.string().trim().toLowerCase().email().optional().or(z.literal("")),
  adjusterPhone: z.string().trim().optional().or(z.literal("")),
});

export type CustomerInput = z.infer<typeof customerSchema>;

/** Coerce empty strings to null so optional DB columns store cleanly. */
export function toCustomerData(input: CustomerInput) {
  const blankToNull = (v: string | undefined) =>
    v === undefined || v.trim() === "" ? null : v.trim();
  return {
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    email: blankToNull(input.email),
    phone: blankToNull(input.phone),
    addressLine1: input.addressLine1.trim(),
    addressLine2: blankToNull(input.addressLine2),
    city: input.city.trim(),
    state: (input.state || "NY").trim().toUpperCase(),
    postalCode: input.postalCode.trim(),
    insuranceCarrier: blankToNull(input.insuranceCarrier),
    policyNumber: blankToNull(input.policyNumber),
    claimNumber: blankToNull(input.claimNumber),
    adjusterName: blankToNull(input.adjusterName),
    adjusterEmail: blankToNull(input.adjusterEmail),
    adjusterPhone: blankToNull(input.adjusterPhone),
  };
}

export function customerDisplayName(c: {
  firstName: string;
  lastName: string;
}): string {
  return `${c.firstName} ${c.lastName}`.trim();
}
