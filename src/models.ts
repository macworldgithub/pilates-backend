import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Schema } from 'mongoose';

const options = { timestamps: true, versionKey: false, strict: 'throw' } as const;
const text = { type: String, required: true, trim: true };
const id = { type: String, required: true };
const published = { type: Boolean, default: false };
const variant = new Schema({ id, title: text, price: { type: Number, min: 0, required: true }, available: { type: Boolean, required: true } }, { _id: false });
const item = new Schema({ productId: id, variantId: id, quantity: { type: Number, min: 1, max: 99, required: true } }, { _id: false });
export const schemas = {
  Studio: new Schema({ _id: id, name: text, description: text, imageUrl: text, city: text, country: text, address: text,
    latitude: { type: Number, required: true }, longitude: { type: Number, required: true }, formats: [String],
    partnerType: { type: String, enum: ['partner', 'stockist', 'listed'], required: true }, websiteUrl: text, bookingUrl: text, published }, options),
  Instructor: new Schema({ _id: id, name: text, bio: text, imageUrl: text, independent: { type: Boolean, default: false },
    approvalStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' }, published }, options),
  Affiliation: new Schema({ studioId: id, instructorId: id }, options),
  Workout: new Schema({ _id: id, title: text, description: text, format: { type: String, enum: ['mat', 'reformer'], required: true },
    level: { type: String, enum: ['beginner', 'intermediate', 'advanced'], required: true }, durationMinutes: { type: Number, required: true },
    interests: [String], studioId: id, instructorIds: [String], productIds: [String], imageUrl: text, videoUrl: text, published,
    publishedAt: { type: Date, required: true } }, options),
  Product: new Schema({ _id: id, title: text, description: text, imageUrl: text, collection: text, tags: [String],
    currency: { type: String, enum: ['AUD', 'USD', 'GBP'], required: true }, variants: [variant], bundleProductIds: [String], published }, { ...options, suppressReservedKeysWarning: true }),
  Referral: new Schema({ _id: id, code: { ...text, uppercase: true }, ownerType: { type: String, enum: ['studio', 'instructor'], required: true }, ownerId: id, active: { type: Boolean, default: true } }, options),
  Offer: new Schema({ _id: id, studioId: id, title: text, description: text, radiusKm: { type: Number, required: true }, active: { type: Boolean, default: true }, expiresAt: { type: Date, required: true } }, options),
  Session: new Schema({ _id: id, tokenHash: text, expiresAt: { type: Date, required: true },
    profile: { type: Schema.Types.Mixed, default: {} }, referralCode: String, cart: { type: [item], default: [] }, revision: { type: Number, default: 0 },
  }, options),
  Order: new Schema({ _id: id, sessionId: id, idempotencyKey: text, requestHash: text, snapshot: { type: Schema.Types.Mixed, required: true } }, options),
  Event: new Schema({ _id: id, sessionId: String, name: text, source: { type: String, enum: ['app', 'web'], required: true }, metadata: { type: Schema.Types.Mixed, default: {} } }, options),
  Audit: new Schema({ _id: id, action: text, entityType: text, entityId: text }, options),
  Seed: new Schema({ _id: id, completedAt: Date }, options),
  AdminSession: new Schema({ _id: id, tokenHash: text, expiresAt: { type: Date, required: true } }, options),
};
schemas.Affiliation.index({ studioId: 1, instructorId: 1 }, { unique: true });
schemas.Session.index({ tokenHash: 1 }, { unique: true });
schemas.Session.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
schemas.AdminSession.index({ tokenHash: 1 }, { unique: true });
schemas.AdminSession.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
schemas.Referral.index({ code: 1 }, { unique: true });
schemas.Order.index({ sessionId: 1, idempotencyKey: 1 }, { unique: true });
schemas.Workout.index({ published: 1, publishedAt: -1 });
schemas.Event.index({ sessionId: 1, createdAt: -1 });

@Global()
@Module({ imports: [MongooseModule.forFeature(Object.entries(schemas).map(([name, schema]) => ({ name, schema })))], exports: [MongooseModule] })
export class ModelsModule {}

export const collections: Record<string, keyof typeof schemas> = {
  studios: 'Studio', instructors: 'Instructor', workouts: 'Workout', products: 'Product', referrals: 'Referral', offers: 'Offer',
};
export function clean(doc: any): any {
  if (!doc) return null;
  const value = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  const { _id, __v, ...rest } = value;
  return { id: String(_id), ...rest };
}
