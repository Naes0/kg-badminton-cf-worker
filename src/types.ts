/**
 * Shared types for the badminton availability worker.
 */

/** Slot ID format: "YYYY-MM-DD|HH:MM-HH:MM|Court Name" */
export type SlotId = string;

export interface KVState {
	lastNotifiedSlots: SlotId[];
	bookedWeek: string | null;
	lastNotificationTimestamp: number;
}

export interface Config {
	timeStartHour: number;
	timeEndHour: number;
	minBlockHours: number;
	timezone: string;
}

/** Single available slot for a court on a date */
export interface AvailableSlot {
	date: string;
	timeSlot: string;
	court: string;
}

/** Contiguous block of available slots for one court on one date */
export interface CourtBlock {
	date: string;
	court: string;
	startSlot: string;
	endSlot: string;
	slotIds: SlotId[];
	hours: number;
}

/** AFA Sports booking API response shape */
export interface BookingResponse {
	success: number;
	message?: string;
	data?: Record<string, Record<string, boolean>>;
}
