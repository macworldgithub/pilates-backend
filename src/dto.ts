import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsString, IsUrl, Length, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested, ValidateBy, isURL } from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

const https = { protocols: ['https'], require_protocol: true };
const IsImageUrl = () => ValidateBy({ name: 'imageUrl', validator: {
  validate: value => typeof value === 'string' && value.length <= 2048 && (/^\/media\/images\/[a-zA-Z0-9/_-]+\.(jpg|jpeg|png|webp)$/.test(value) || isURL(value, https)),
  defaultMessage: () => 'imageUrl must be an HTTPS URL or a backend /media/images/ path',
} });
// Optional means absent, not null; null cannot bypass validation.
const IsOptional = () => ValidateIf((_object, value) => value !== undefined);
export class PageQuery {
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
  @ApiPropertyOptional({ default: 20 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) search?: string;
}
export class DiscoverQuery extends PageQuery {
  @ApiPropertyOptional({ enum: ['mat', 'reformer'] }) @IsOptional() @IsIn(['mat', 'reformer']) format?: string;
  @ApiPropertyOptional({ enum: ['beginner', 'intermediate', 'advanced'] }) @IsOptional() @IsIn(['beginner', 'intermediate', 'advanced']) level?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) interest?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) city?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) collection?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) tag?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(-90) @Max(90) latitude?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(-180) @Max(180) longitude?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0.1) @Max(20000) radiusKm?: number;
  @ApiPropertyOptional({ enum: ['newest', 'nearest', 'price-asc', 'price-desc'] }) @IsOptional() @IsIn(['newest', 'nearest', 'price-asc', 'price-desc']) sort?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) studioId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) instructorId?: string;
}
export class ProfileDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 100) area?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(-90) @Max(90) latitude?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(-180) @Max(180) longitude?: number;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(10) @ArrayUnique() @IsIn(['strength', 'mobility', 'balance', 'relaxation', 'flexibility'], { each: true }) interests?: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(2) @ArrayUnique() @IsIn(['mat', 'reformer'], { each: true }) formats?: string[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() onboardingComplete?: boolean;
}
export class StudioDto {
  @ApiProperty() @IsString() @Length(1, 200) name!: string;
  @ApiProperty() @IsString() @Length(1, 5000) description!: string;
  @ApiProperty() @IsImageUrl() imageUrl!: string;
  @ApiProperty() @IsString() @Length(1, 100) city!: string;
  @ApiProperty() @Matches(/^[A-Z]{2}$/) country!: string;
  @ApiProperty() @IsString() @Length(1, 300) address!: string;
  @ApiProperty() @IsNumber() @Min(-90) @Max(90) latitude!: number;
  @ApiProperty() @IsNumber() @Min(-180) @Max(180) longitude!: number;
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(2) @ArrayUnique() @IsIn(['mat', 'reformer'], { each: true }) formats!: string[];
  @ApiProperty({ enum: ['partner', 'stockist', 'listed'] }) @IsIn(['partner', 'stockist', 'listed']) partnerType!: string;
  @ApiProperty() @IsUrl(https) websiteUrl!: string;
  @ApiProperty() @IsUrl(https) bookingUrl!: string;
  @ApiProperty() @IsBoolean() published!: boolean;
}
export class InstructorDto {
  @ApiProperty() @IsString() @Length(1, 200) name!: string;
  @ApiProperty() @IsString() @Length(1, 5000) bio!: string;
  @ApiProperty() @IsImageUrl() imageUrl!: string;
  @ApiProperty() @IsBoolean() independent!: boolean;
  @ApiProperty({ enum: ['pending', 'approved', 'rejected'] }) @IsIn(['pending', 'approved', 'rejected']) approvalStatus!: string;
  @ApiProperty() @IsBoolean() published!: boolean;
}
export class WorkoutDto {
  @ApiProperty() @IsString() @Length(1, 200) title!: string;
  @ApiProperty() @IsString() @Length(1, 5000) description!: string;
  @ApiProperty({ enum: ['mat', 'reformer'] }) @IsIn(['mat', 'reformer']) format!: string;
  @ApiProperty({ enum: ['beginner', 'intermediate', 'advanced'] }) @IsIn(['beginner', 'intermediate', 'advanced']) level!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(240) durationMinutes!: number;
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(20) @ArrayUnique() @IsString({ each: true }) @MaxLength(100, { each: true }) interests!: string[];
  @ApiProperty() @IsString() @Length(1, 100) studioId!: string;
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(30) @ArrayUnique() @IsString({ each: true }) @Length(1, 100, { each: true }) instructorIds!: string[];
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(30) @ArrayUnique() @IsString({ each: true }) @Length(1, 100, { each: true }) productIds!: string[];
  @ApiProperty() @IsImageUrl() imageUrl!: string;
  @ApiProperty() @IsUrl(https) videoUrl!: string;
  @ApiProperty() @IsBoolean() published!: boolean;
  @ApiProperty() @IsDateString() publishedAt!: string;
}
export class VariantDto {
  @ApiProperty() @Matches(/^[a-zA-Z0-9_-]{1,100}$/) id!: string;
  @ApiProperty() @IsString() @Length(1, 200) title!: string;
  @ApiProperty({ description: 'Integer minor currency units, e.g. 2200 = AUD 22.00' }) @IsInt() @Min(0) @Max(10000000) price!: number;
  @ApiProperty() @IsBoolean() available!: boolean;
}
export class ProductDto {
  @ApiProperty() @IsString() @Length(1, 200) title!: string;
  @ApiProperty() @IsString() @Length(1, 5000) description!: string;
  @ApiProperty() @IsImageUrl() imageUrl!: string;
  @ApiProperty() @IsString() @Length(1, 100) collection!: string;
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(30) @ArrayUnique() @IsString({ each: true }) @Length(1, 100, { each: true }) tags!: string[];
  @ApiProperty({ enum: ['AUD', 'USD', 'GBP'] }) @IsIn(['AUD', 'USD', 'GBP']) currency!: string;
  @ApiProperty({ type: [VariantDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => VariantDto) variants!: VariantDto[];
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(20) @ArrayUnique() @IsString({ each: true }) @Length(1, 100, { each: true }) bundleProductIds!: string[];
  @ApiProperty() @IsBoolean() published!: boolean;
}
export class ReferralDto {
  @ApiProperty() @Matches(/^[A-Z0-9-]{3,40}$/) code!: string;
  @ApiProperty({ enum: ['studio', 'instructor'] }) @IsIn(['studio', 'instructor']) ownerType!: string;
  @ApiProperty() @IsString() @Length(1, 100) ownerId!: string;
  @ApiProperty() @IsBoolean() active!: boolean;
}
export class OfferDto {
  @ApiProperty() @IsString() @Length(1, 100) studioId!: string;
  @ApiProperty() @IsString() @Length(1, 200) title!: string;
  @ApiProperty() @IsString() @Length(1, 2000) description!: string;
  @ApiProperty() @IsNumber() @Min(0.1) @Max(500) radiusKm!: number;
  @ApiProperty() @IsBoolean() active!: boolean;
  @ApiProperty() @IsDateString() expiresAt!: string;
}
export class UpdateStudioDto extends PartialType(StudioDto, { skipNullProperties: false }) {}
export class UpdateInstructorDto extends PartialType(InstructorDto, { skipNullProperties: false }) {}
export class UpdateWorkoutDto extends PartialType(WorkoutDto, { skipNullProperties: false }) {}
export class UpdateProductDto extends PartialType(ProductDto, { skipNullProperties: false }) {}
export class UpdateReferralDto extends PartialType(ReferralDto, { skipNullProperties: false }) {}
export class UpdateOfferDto extends PartialType(OfferDto, { skipNullProperties: false }) {}
export class AffiliationDto {
  @ApiProperty() @IsString() @Length(1, 100) studioId!: string;
  @ApiProperty() @IsString() @Length(1, 100) instructorId!: string;
}
export class CartItemDto {
  @ApiProperty() @IsString() @Length(1, 100) productId!: string;
  @ApiProperty() @IsString() @Length(1, 100) variantId!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(99) quantity!: number;
}
export class ApplyReferralDto {
  @ApiProperty() @Matches(/^[A-Z0-9-]{3,40}$/) code!: string;
}
export class CheckoutDto {
  @ApiPropertyOptional({ enum: ['WELCOME15', 'SEASON10'] }) @IsOptional() @IsIn(['WELCOME15', 'SEASON10']) discountCode?: string;
  @ApiProperty({ enum: ['delivery', 'warehouse-collect'] }) @IsIn(['delivery', 'warehouse-collect']) fulfillment!: string;
  @ApiProperty({ enum: ['app', 'web'] }) @IsIn(['app', 'web']) source!: string;
}
export class EventDto {
  @ApiProperty({ enum: ['workout_opened', 'studio_opened', 'product_opened', 'referral_opened', 'booking_link_opened'] })
  @IsIn(['workout_opened', 'studio_opened', 'product_opened', 'referral_opened', 'booking_link_opened']) name!: string;
  @ApiProperty({ enum: ['app', 'web'] }) @IsIn(['app', 'web']) source!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 100) entityId?: string;
}
