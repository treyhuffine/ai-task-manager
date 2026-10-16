/**
 * Fictional confirmation messages. Every name, address, reference and
 * provider is invented for previews and tests. They go through the same
 * parser and ingestion as real sources.
 */
export interface FixtureMessage {
  id: string;
  subject: string;
  from: string;
  receivedAt: string;
  text: string;
}

export const FIXTURE_TRAVELER = "Alex Rivera";

export const LISBON_FLIGHT: FixtureMessage = {
  id: "fx-flight-lisbon",
  subject: "Your Riverline Air booking is confirmed",
  from: "Riverline Air <no-reply@riverline-air.example>",
  receivedAt: "2026-10-12T15:04:00.000Z",
  text: `Riverline Air
Booking confirmed

Confirmation number: RA-7416
Passenger: RIVERA/ALEX MR

Flight RA 204
Departure: Denver (DEN)  Mon, Nov 9, 2026  17:55
Arrival: Lisbon (LIS)  Tue, Nov 10, 2026  08:40
Economy, seat 23C

Flight RA 205
Departure: Lisbon (LIS)  Sat, Nov 14, 2026  13:30
Arrival: Denver (DEN)  Sat, Nov 14, 2026  18:20

Manage your booking at any time. This is a fictional example message.`,
};

export const LISBON_HOTEL: FixtureMessage = {
  id: "fx-hotel-lisbon",
  subject: "Your stay at Riverside House is confirmed",
  from: "Riverside House <reservations@riverside-house.example>",
  receivedAt: "2026-10-14T09:12:00.000Z",
  text: `Riverside House
Thank you for booking with us.

Booking reference: RH-4821
Guest name: Alex Rivera
Check-in: Tue, Nov 10, 2026 (from 14:00)
Check-out: Sat, Nov 14, 2026 (until 11:00)
4 nights
Room: Deluxe double room
Address: Rua da Prata 112, 1100-420 Lisbon, Portugal

Free cancellation until Nov 3, 2026. This is a fictional example message.`,
};

/** The hotel revises check-in after the traveler corrected it by hand. */
export const LISBON_HOTEL_REVISED: FixtureMessage = {
  id: "fx-hotel-lisbon-revised",
  subject: "Updated reservation: your stay at Riverside House",
  from: "Riverside House <reservations@riverside-house.example>",
  receivedAt: "2026-10-14T17:40:00.000Z",
  text: `Riverside House
Your booking has been updated.

Booking reference: RH-4821
Guest name: Alex Rivera
Check-in: Tue, Nov 10, 2026 (from 16:00)
Check-out: Sat, Nov 14, 2026 (until 11:00)
4 nights
Room: Deluxe double room
Address: Rua da Prata 112, 1100-420 Lisbon, Portugal

This is a fictional example message.`,
};

export const LISBON_DINNER: FixtureMessage = {
  id: "fx-dinner-lisbon",
  subject: "Your table at Mesa is confirmed",
  from: "Mesa <tables@mesa-lisboa.example>",
  receivedAt: "2026-10-14T11:20:00.000Z",
  text: `Mesa
We look forward to welcoming you for dinner.

Name: Alex Rivera
Date: Tuesday, November 10, 2026
Time: 19:00
Table for one
Address: Rua dos Fanqueiros 41, Lisbon
Confirmation: MS-1834

This is a fictional example message.`,
};

/** Forwarded from a friend and naming two drivers, so it waits in Review. */
export const LISBON_CAR_FORWARDED: FixtureMessage = {
  id: "fx-car-lisbon",
  subject: "Fwd: Coastal Car Rental confirmation CR-55210",
  from: "Sam Okafor <sam.okafor@example.test>",
  receivedAt: "2026-10-13T20:05:00.000Z",
  text: `Sharing the car details for Thursday.

---------- Forwarded message ---------
From: Coastal Car Rental <bookings@coastal-rental.example>
Date: Oct 13, 2026
Subject: Your car rental confirmation

Rental confirmation number: CR-55210
Drivers: Alex Rivera and Sam Okafor
Pick-up: Lisbon Airport (LIS), Thu, Nov 12, 2026 09:00
Return: Lisbon Airport (LIS), Fri, Nov 13, 2026 18:00
Vehicle: Compact, manual

This is a fictional example message.`,
};

/** A pasted note whose date can be read two ways. */
export const SINTRA_TICKETS_PASTED = `Sintra palace tickets
Booking reference: SP-20931
Name: Alex Rivera
Date: 11/12/2026
Time: 10:30
Tickets: 1 adult
Location: Palacio da Pena, Sintra`;

export const PORTLAND_TRAIN: FixtureMessage = {
  id: "fx-train-portland",
  subject: "Your Coast Line train tickets",
  from: "Coast Line Rail <tickets@coastline-rail.example>",
  receivedAt: "2026-10-09T18:30:00.000Z",
  text: `Coast Line Rail
Your tickets are confirmed.

Booking reference: CL8842
Passenger: Alex Rivera
Train: Coast Line 11
Departure: Seattle King Street Station, Fri, Dec 4, 2026 08:20
Arrival: Portland Union Station, Fri, Dec 4, 2026 11:55
Coach 4, seat 12A

This is a fictional example message.`,
};

export const PORTLAND_HOTEL: FixtureMessage = {
  id: "fx-hotel-portland",
  subject: "Your stay at Alder Street Inn is confirmed",
  from: "Alder Street Inn <stay@alder-street-inn.example>",
  receivedAt: "2026-10-10T16:00:00.000Z",
  text: `Alder Street Inn
Booking reference: ASI-30417
Guest name: Alex Rivera
Check-in: Fri, Dec 4, 2026 (from 15:00)
Check-out: Sun, Dec 6, 2026 (until 11:00)
2 nights
Address: 410 SW Alder Street, Portland, Oregon

This is a fictional example message.`,
};

export const PORTLAND_RETURN_TRAIN: FixtureMessage = {
  id: "fx-train-portland-return",
  subject: "Your Coast Line train tickets",
  from: "Coast Line Rail <tickets@coastline-rail.example>",
  receivedAt: "2026-10-09T18:34:00.000Z",
  text: `Coast Line Rail
Your tickets are confirmed.

Booking reference: CL8857
Passenger: Alex Rivera
Train: Coast Line 18
Departure: Portland Union Station, Mon, Dec 7, 2026 17:40
Arrival: Seattle King Street Station, Mon, Dec 7, 2026 21:15

This is a fictional example message.`,
};

export const MEXICO_FLIGHT: FixtureMessage = {
  id: "fx-flight-mexico",
  subject: "Booking confirmed: Denver to Mexico City",
  from: "Riverline Air <no-reply@riverline-air.example>",
  receivedAt: "2026-07-20T12:00:00.000Z",
  text: `Riverline Air
Confirmation number: RA-3390
Passenger: Alex Rivera

Flight RA 610
Departure: Denver (DEN)  Fri, Aug 14, 2026  09:10
Arrival: Mexico City (MEX)  Fri, Aug 14, 2026  13:25

Flight RA 611
Departure: Mexico City (MEX)  Tue, Aug 18, 2026  15:00
Arrival: Denver (DEN)  Tue, Aug 18, 2026  19:05

This is a fictional example message.`,
};

export const MEXICO_HOTEL: FixtureMessage = {
  id: "fx-hotel-mexico",
  subject: "Your stay at Casa Jacaranda is confirmed",
  from: "Casa Jacaranda <hola@casa-jacaranda.example>",
  receivedAt: "2026-07-21T12:00:00.000Z",
  text: `Casa Jacaranda
Booking reference: CJ-7720
Guest name: Alex Rivera
Check-in: Fri, Aug 14, 2026 (from 15:00)
Check-out: Tue, Aug 18, 2026 (until 12:00)
Address: Calle Colima 210, Roma Norte, Mexico City

This is a fictional example message.`,
};
