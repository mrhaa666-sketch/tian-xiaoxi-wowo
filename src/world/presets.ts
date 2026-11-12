// 新存档的初始小屋：两层楼，左边是楼梯间。
import { World } from "./world";

export function buildStarterHouse(world: World) {
  // 一楼：楼梯间、客厅（两格宽）、厨房、浴室、院子
  world.addRoom("stairs", 0, 0);
  world.addRoom("living", 1, 0);
  world.addRoom("kitchen", 3, 0);
  world.addRoom("bathroom", 4, 0);
  world.addRoom("yard", 5, 0);
  // 二楼：楼梯间、两间卧室、书房
  world.addRoom("stairs", 0, 1, "楼梯间2");
  world.addRoom("bedroom", 1, 1, "卧室A");
  world.addRoom("bedroom", 2, 1, "卧室B");
  world.addRoom("study", 3, 1);
}
