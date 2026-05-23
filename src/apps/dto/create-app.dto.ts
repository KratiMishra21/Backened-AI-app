import { IsNotEmpty } from 'class-validator';

export class CreateAppDto {
  @IsNotEmpty()
  config: any;
}
