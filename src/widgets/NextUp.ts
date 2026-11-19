import type { NextUpProps } from './types';

const NextUp = {
  updateSnapshot(_props: NextUpProps): void {},
  updateTimeline(_entries: { date: Date; props: NextUpProps }[]): void {},
};
export default NextUp;
