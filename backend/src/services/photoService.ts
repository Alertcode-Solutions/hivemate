// Photo service for handling photo uploads
// For MVP, we'll store photos as base64 strings or URLs
// In production, this would integrate with AWS S3 or similar

export class PhotoService {
  /**
   * Validate photo URL or base64 string
   */
  static validatePhoto(photo: string): boolean {
    // Check if it's a valid URL
    if (photo.startsWith('http://') || photo.startsWith('https://')) {
      try {
        new URL(photo);
        return true;
      } catch {
        return false;
      }
    }

    // Check if it's a valid base64 image
    const base64Regex = /^data:image\/(png|jpg|jpeg|gif|webp|heic|heif);base64,/;
    return base64Regex.test(photo);
  }

  /**
   * Upload photo (mock implementation for MVP)
   * In production, this would upload to S3 and return the URL
   */
  static async uploadPhoto(photo: string, _userId: string): Promise<string> {
    // Validate photo
    if (!this.validatePhoto(photo)) {
      throw new Error('Invalid photo format');
    }

    // For MVP, we'll just return the photo as-is
    // In production, upload to S3:
    // const s3Url = await uploadToS3(photo, userId);
    // return s3Url;

    return photo;
  }

  /**
   * Delete photo (mock implementation for MVP)
   */
  static async deletePhoto(_photoUrl: string): Promise<void> {
    // In production, delete from S3:
    // await deleteFromS3(photoUrl);
    
    // For MVP, no action needed
    return;
  }

  /**
   * Get photo size in bytes (for base64 strings)
   */
  static getPhotoSize(photo: string): number {
    if (photo.startsWith('data:image')) {
      const base64 = photo.split(',')[1];
      return Math.ceil((base64.length * 3) / 4);
    }
    return 0;
  }

  /**
   * Validate photo size (max 5MB)
   */
  static validatePhotoSize(photo: string): boolean {
    const MAX_SIZE = 5 * 1024 * 1024; // 5MB
    const size = this.getPhotoSize(photo);
    return size <= MAX_SIZE;
  }
}
